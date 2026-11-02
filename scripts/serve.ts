/**
 * Standalone host for Cascade.
 *
 * Serves the same React panel the Forge app serves, backed by the same pipeline,
 * over plain HTTP. No Jira, no Forge, no install link — just a URL.
 *
 *   npx tsx scripts/serve.ts            # http://localhost:4173
 *   PORT=8080 npx tsx scripts/serve.ts
 *
 * The graph source is the seeded demo graph by default. Point CASCADE_SOURCE=graph
 * at the real Teamwork Graph once query keys exist.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPipeline } from '../src/pipeline/run';
import { createDemoSource } from '../src/demo/seedSource';
import { createLiveGraphSource } from '../src/demo/liveGraph';
import { createGraphSource } from '../src/graph/source';
import { createRecordedCaller, SANDBOX_ATTRIBUTION_PAGES, SANDBOX_PAGES } from '../src/graph/sandbox';
import { runPersistedQuery } from '../src/graph/client';
import { attributeFromRows, summariseAttribution } from '../src/attribution/attribute';
import { computeCaseBase, findSimilarFor } from '../src/decisions/service';
import { DecisionStore } from '../src/decisions/store';
import { createSqliteDriver } from '../src/storage/sqliteDriver';
import { loadDecisionDirectory } from '../src/runner/load';
import { createHostExecutors } from '../src/runner/executors';
import { parseIntentLocally } from '../src/domain/intent';
import type { RunSnapshotDto } from '../src/shared/dtos';
import type { Horizon } from '../src/shared/types';
import { isEventKind, type EventKind } from '../src/domain/events';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB_ROOT = join(ROOT, 'static', 'panel', 'build-web');
const PORT = Number(process.env.PORT ?? 4173);
const DEMO_WORK_ITEM = process.env.CASCADE_WORK_ITEM ?? 'CX-11';

/**
 * Which sandbox layer to run:
 *   artifacts (default) → seeded artefacts, bypasses the graph client entirely
 *   recorded            → recorded Teamwork Graph payloads through the real
 *                         transport: paging, retries, scope probe and row
 *                         mapping all execute exactly as in production
 */
const SOURCE =
  process.env.CASCADE_SOURCE === 'recorded'
    ? 'recorded'
    : process.env.CASCADE_SOURCE === 'live'
      ? 'live'
      : 'artifacts';

function buildSource() {
  // `live` replays real Teamwork Graph payloads recorded from the site.
  if (SOURCE === 'live') return createLiveGraphSource();
  if (SOURCE === 'recorded') {
    return createGraphSource(
      createRecordedCaller(SANDBOX_PAGES),
      { spine: 'spine', branches: 'branches', outcomes: 'outcomes' },
      { now: () => new Date().toISOString() },
    );
  }
  return createDemoSource();
}

const runs = new Map<string, RunSnapshotDto>();

/**
 * Persistence switch. `memory` (default) keeps everything in the request scope;
 * `sqlite` writes the ledger through the same SQL that TiDB will run.
 */
/**
 * Decisions are read from the repository, not from a fixture: the case base is
 * derived from `.decisions/*.decision` files plus the code they assert on.
 */
const DECISIONS_DIR = process.env.CASCADE_DECISIONS ?? 'examples/decision-repo/.decisions';
const DECISIONS_ROOT = process.env.CASCADE_DECISIONS_ROOT ?? 'examples/decision-repo';

const STORE = process.env.CASCADE_STORE === 'sqlite' ? 'sqlite' : 'memory';
const store = STORE === 'sqlite' ? new DecisionStore(createSqliteDriver(process.env.CASCADE_DB ?? ':memory:')) : null;

/** The case base is deterministic, so it is computed once and served from memory. */
let caseBase: Awaited<ReturnType<typeof computeCaseBase>>['report'] | null = null;
let persistInfo: { enabled: boolean; decisions: number; patterns: number; runs: number } = {
  enabled: false,
  decisions: 0,
  patterns: 0,
  runs: 0,
};

let caseModels: Awaited<ReturnType<typeof computeCaseBase>>['models'] = [];

async function loadCorpus() {
  const loaded = await loadDecisionDirectory(DECISIONS_DIR);
  return {
    decisions: loaded.decisions,
    errors: loaded.errors,
    executors: createHostExecutors({ root: DECISIONS_ROOT }),
  };
}

async function getCaseBase() {
  if (caseBase) return caseBase;

  const corpus = await loadCorpus();
  const computed = await computeCaseBase(corpus.decisions, corpus.executors);
  caseBase = computed.report;
  caseModels = computed.models;

  if (store) {
    await store.ensureSchema();
    await store.saveDecisions(caseModels);
    await store.savePatterns(caseBase.patterns);
    await store.recordRun(caseBase);
    const snapshot = await store.snapshot();
    persistInfo = {
      enabled: true,
      decisions: snapshot.decisions.length,
      patterns: snapshot.patterns.length,
      runs: snapshot.runs.length,
    };
  }

  return caseBase;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0] ?? '/')).replace(/^(\.\.[/\\])+/, '');
  const candidate = clean === '/' || clean === '' ? 'index.html' : clean.replace(/^\//, '');
  const full = join(WEB_ROOT, candidate);

  let body: Buffer;
  try {
    body = await readFile(full);
  } catch {
    // SPA fallback: any unknown path returns the shell.
    try {
      body = await readFile(join(WEB_ROOT, 'index.html'));
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Panel bundle missing. Run: npm --prefix static/panel run build:web');
      return;
    }
  }

  const type = MIME[extname(full)] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

async function handleRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const workItemKey = typeof body.workItemKey === 'string' && body.workItemKey ? body.workItemKey : DEMO_WORK_ITEM;
  const intentText = typeof body.intentText === 'string' ? body.intentText : '';
  const eventKind: EventKind | undefined = isEventKind(body.eventKind) ? body.eventKind : undefined;
  const horizon: Horizon =
    body.horizon === 'quarters' || body.horizon === 'years' || body.horizon === 'weeks' ? body.horizon : 'weeks';

  const runId = `web-${Date.now().toString(36)}`;
  const createdAt = new Date().toISOString();

  try {
    const result = await runPipeline(
      { runId, workItemKey, eventKind, intentText, horizon, failureAt: createdAt, createdAt },
      {
        source: buildSource(),
        parseIntent: async (text, h) => parseIntentLocally(text, h),
        now: () => new Date().toISOString(),
      },
    );
    runs.set(runId, result.snapshot);
    sendJson(res, 200, { runId });
  } catch (error) {
    sendJson(res, 500, { error: 'PIPELINE_FAILED', message: error instanceof Error ? error.message : String(error) });
  }
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';

  if (url === '/api/health') {
    sendJson(res, 200, { demoMode: true, configured: true, probeTypes: [], workItemKey: DEMO_WORK_ITEM });
    return;
  }

  if (url === '/api/decisions') {
    void getCaseBase().then(
      (report) => sendJson(res, 200, { ...report, persistence: persistInfo }),
      (error: unknown) =>
        sendJson(res, 500, { error: 'CASE_BASE_FAILED', message: error instanceof Error ? error.message : String(error) }),
    );
    return;
  }

  if (url === '/api/attribution') {
    void (async () => {
      const caller = createRecordedCaller(SANDBOX_ATTRIBUTION_PAGES);
      const result = await runPersistedQuery(
        caller,
        'attribution',
        { decisionPrefix: 'decision/', limit: 25 },
        (rows) => rows,
        { sleep: async () => undefined },
      );
      sendJson(res, 200, {
        errorCode: result.errorCode,
        pages: result.pages,
        summary: summariseAttribution(attributeFromRows(result.rows)),
      });
    })();
    return;
  }

  if (url === '/api/decisions/snapshot') {
    if (!store) {
      sendJson(res, 501, { error: 'STORE_DISABLED', message: 'Run with CASCADE_STORE=sqlite' });
      return;
    }
    void store.snapshot().then(
      (snapshot) =>
        sendJson(res, 200, {
          decisions: snapshot.decisions.map((d) => ({ id: d.id, status: d.status, results: d.results.length })),
          patterns: snapshot.patterns.map((p) => ({ id: p.id, confidence: p.confidence })),
          runs: snapshot.runs,
        }),
      (error: unknown) =>
        sendJson(res, 500, { error: 'SNAPSHOT_FAILED', message: error instanceof Error ? error.message : String(error) }),
    );
    return;
  }

  if (url.startsWith('/api/decisions/similar')) {
    const id = new URL(url, 'http://localhost').searchParams.get('id') ?? '';
    void loadCorpus()
      .then((corpus) => findSimilarFor(id, corpus.decisions, corpus.executors))
      .then(
        (result) => sendJson(res, 200, result),
        (error: unknown) =>
          sendJson(res, 500, { error: 'SIMILAR_FAILED', message: error instanceof Error ? error.message : String(error) }),
      );
    return;
  }

  if (url === '/api/runs' && req.method === 'POST') {
    void handleRun(req, res);
    return;
  }

  const match = /^\/api\/runs\/([^/?]+)/.exec(url);
  if (match?.[1]) {
    const snapshot = runs.get(decodeURIComponent(match[1]));
    if (!snapshot) {
      sendJson(res, 404, { error: 'NOT_FOUND', message: 'That run no longer exists.' });
      return;
    }
    sendJson(res, 200, { snapshot });
    return;
  }

  if (url.startsWith('/api/')) {
    sendJson(res, 404, { error: 'NO_ROUTE' });
    return;
  }

  void serveStatic(res, url);
});

server.listen(PORT, () => {
  console.log(`Cascade standalone listening on http://localhost:${PORT}`);
  console.log(`  panel bundle: ${WEB_ROOT}`);
  console.log(`  demo work item: ${DEMO_WORK_ITEM}`);
  console.log(`  source: ${SOURCE}  (set CASCADE_SOURCE=recorded for the graph sandbox)`);
  console.log(`  store: ${STORE}  (set CASCADE_STORE=sqlite to persist the ledger)`);
  console.log(`  decisions: ${DECISIONS_DIR}  (root ${DECISIONS_ROOT})`);
});
