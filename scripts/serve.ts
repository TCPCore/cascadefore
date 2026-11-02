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
import { parseIntentLocally } from '../src/domain/intent';
import type { RunSnapshotDto } from '../src/shared/dtos';
import type { Horizon } from '../src/shared/types';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB_ROOT = join(ROOT, 'static', 'panel', 'build-web');
const PORT = Number(process.env.PORT ?? 4173);
const DEMO_WORK_ITEM = process.env.CASCADE_WORK_ITEM ?? 'CX-11';

const runs = new Map<string, RunSnapshotDto>();

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
  const horizon: Horizon =
    body.horizon === 'quarters' || body.horizon === 'years' || body.horizon === 'weeks' ? body.horizon : 'weeks';

  const runId = `web-${Date.now().toString(36)}`;
  const createdAt = new Date().toISOString();

  try {
    const result = await runPipeline(
      { runId, workItemKey, intentText, horizon, failureAt: createdAt, createdAt },
      {
        source: createDemoSource(),
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
});
