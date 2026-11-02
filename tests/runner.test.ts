import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { loadDecisionDirectory } from '../src/runner/load';
import { createHostExecutors } from '../src/runner/executors';
import { describe as describeStatus, statusKeyFor, toCommitStatuses } from '../src/runner/status';
import { buildRunnerReport, formatText } from '../src/runner/report';
import { runAll } from '../src/decisions/runner';
import { createRecordedCaller, SANDBOX_PAGES } from '../src/graph/sandbox';
import { loadSeedDecisions, createFixtureExecutors } from '../src/decisions/seed';
import type { Decision, DecisionTest } from '../src/decisions/types';

const VALID = `
id: 9001-use-postgres
decision: Use Postgres as the primary datastore
decided_at: 2026-03-14T10:00:00Z
domain: [datastore]
constraints: ["#acid-required"]
rationale: ACID for the ledger.
tests:
  - name: compose declares postgres
    kind: file_match
    target: infra/docker-compose.yml
    pattern: 'image: postgres:'
`;

const INVALID = `
id: broken
decision: missing decided_at
tests: []
`;

async function fixtureRepo(): Promise<{ dir: string; root: string }> {
  const base = await mkdtemp(join(tmpdir(), 'cascade-runner-'));
  const dir = join(base, '.decisions');
  const root = join(base, 'repo');
  await mkdir(dir, { recursive: true });
  await mkdir(join(root, 'infra'), { recursive: true });
  await writeFile(join(root, 'infra/docker-compose.yml'), 'services:\n  db:\n    image: postgres:16\n');
  await writeFile(join(dir, '9001-use-postgres.decision'), VALID);
  await writeFile(join(dir, 'bad.decision'), INVALID);
  await writeFile(join(dir, 'notes.txt'), 'ignored');
  return { dir, root };
}

function decisionWith(tests: DecisionTest[], id = '9002'): Decision {
  return {
    id,
    decision: 'a decision',
    decidedAt: '2026-01-01T00:00:00.000Z',
    decidedBy: [],
    domain: ['datastore'],
    constraints: [],
    rationale: '',
    alternatives: [],
    tests,
    links: [],
    status: 'unknown',
    results: [],
    lastRunAt: null,
  };
}

describe('loading a .decisions directory', () => {
  it('reads every .decision file and ignores other files', async () => {
    const { dir } = await fixtureRepo();
    const loaded = await loadDecisionDirectory(dir);
    expect(loaded.decisions).toHaveLength(1);
    expect(loaded.decisions[0]?.id).toBe('9001-use-postgres');
  });

  it('reports a parse error without losing the good files', async () => {
    const { dir } = await fixtureRepo();
    const loaded = await loadDecisionDirectory(dir);
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]?.message).toMatch(/decided_at/);
    expect(loaded.decisions).toHaveLength(1);
  });

  it('handles a missing directory without throwing', async () => {
    const loaded = await loadDecisionDirectory('/tmp/definitely-not-here-cascade');
    expect(loaded.decisions).toEqual([]);
    expect(loaded.errors[0]?.message).toMatch(/not found/);
  });
});

describe('file_match executor', () => {
  it('passes when the pattern is present', async () => {
    const { root } = await fixtureRepo();
    const executors = createHostExecutors({ root });
    const result = await executors.file_match!({
      kind: 'file_match',
      name: 't',
      target: 'infra/docker-compose.yml',
      pattern: 'image: postgres:',
    });
    expect(result.passed).toBe(true);
    expect(result.evidence).toMatch(/matched/);
  });

  it('fails clearly when the file is missing', async () => {
    const { root } = await fixtureRepo();
    const executors = createHostExecutors({ root });
    const result = await executors.file_match!({
      kind: 'file_match',
      name: 't',
      target: 'infra/monitoring.yaml',
      pattern: 'x',
    });
    expect(result.passed).toBe(false);
    expect(result.evidence).toMatch(/file not found/);
  });

  it('fails on an invalid pattern instead of throwing', async () => {
    const { root } = await fixtureRepo();
    const executors = createHostExecutors({ root });
    const result = await executors.file_match!({
      kind: 'file_match',
      name: 't',
      target: 'infra/docker-compose.yml',
      pattern: '([',
    });
    expect(result.passed).toBe(false);
    expect(result.evidence).toMatch(/invalid pattern/);
  });
});

describe('http executor', () => {
  it('checks status and body against a live server', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok: healthy');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}/health`;

    try {
      const executors = createHostExecutors({ root: '.' });

      const ok = await executors.http!({ kind: 'http', name: 't', url, expect_body: 'healthy' });
      expect(ok.passed).toBe(true);

      const wrongBody = await executors.http!({ kind: 'http', name: 't', url, expect_body: 'degraded' });
      expect(wrongBody.passed).toBe(false);

      const wrongStatus = await executors.http!({ kind: 'http', name: 't', url, expect_status: 500 });
      expect(wrongStatus.passed).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('reports an unreachable host as a failure, not a crash', async () => {
    const executors = createHostExecutors({ root: '.' });
    const result = await executors.http!({
      kind: 'http',
      name: 't',
      url: 'http://127.0.0.1:1/nope',
    });
    expect(result.passed).toBe(false);
    expect(result.evidence).toMatch(/request failed/);
  });
});

describe('graph executor', () => {
  it('passes when the recorded graph returns the expected row count', async () => {
    const executors = createHostExecutors({
      root: '.',
      graph: createRecordedCaller(SANDBOX_PAGES),
    });
    const result = await executors.graph!({
      kind: 'graph',
      name: 't',
      cypher_key: 'spine',
      params: {},
      expect: 1,
    });
    expect(result.passed).toBe(true);
    expect(result.evidence).toMatch(/expected 1 row/);
  });

  it('fails when the expectation does not match', async () => {
    const executors = createHostExecutors({
      root: '.',
      graph: createRecordedCaller(SANDBOX_PAGES),
    });
    const result = await executors.graph!({
      kind: 'graph',
      name: 't',
      cypher_key: 'spine',
      params: {},
      expect: 99,
    });
    expect(result.passed).toBe(false);
    expect(result.evidence).toMatch(/expected 99/);
  });

  it('fails honestly when no graph is configured', async () => {
    const executors = createHostExecutors({ root: '.' });
    const result = await executors.graph!({
      kind: 'graph',
      name: 't',
      cypher_key: 'spine',
      params: {},
      expect: 1,
    });
    expect(result.passed).toBe(false);
    expect(result.evidence).toMatch(/no Teamwork Graph caller/);
  });
});

describe('commit statuses', () => {
  it('maps lifecycle to Bitbucket states', async () => {
    const decisions = await runAll(
      [
        decisionWith([{ kind: 'file_match', name: 'a', target: 'x', pattern: 'y' }], 'enforced-one'),
        {
          ...decisionWith([{ kind: 'file_match', name: 'a', target: 'x', pattern: 'y' }], 'violated-one'),
        },
        decisionWith([{ kind: 'manual', name: 'm', note: 'n' }], 'orphan-one'),
      ],
      {
        file_match: async () => ({ passed: true, evidence: 'ok' }),
      },
    );

    const statuses = toCommitStatuses(decisions);
    expect(statuses.map((s) => s.state)).toEqual(['SUCCESSFUL', 'SUCCESSFUL', 'STOPPED']);
  });

  it('keeps the key within the 40-character limit', () => {
    const long = 'a'.repeat(120);
    expect(statusKeyFor(long).length).toBeLessThanOrEqual(40);
    expect(statusKeyFor('0012').startsWith('decision/')).toBe(true);
  });

  it('explains an orphaned decision rather than implying success', () => {
    const orphan: Decision = {
      ...decisionWith([{ kind: 'manual', name: 'm', note: 'n' }]),
      status: 'orphaned',
      results: [{ name: 'm', kind: 'manual', passed: false, skipped: true, durationMs: 0, evidence: 'n' }],
    };
    expect(describeStatus(orphan)).toMatch(/no machine-checkable assertion/);
  });

  it('names the failing test in a violated status', () => {
    const violated: Decision = {
      ...decisionWith([]),
      status: 'violated',
      results: [
        { name: 'monitoring config', kind: 'file_match', passed: false, skipped: false, durationMs: 1, evidence: 'missing' },
      ],
    };
    expect(describeStatus(violated)).toMatch(/monitoring config/);
  });
});

describe('runner report', () => {
  it('counts statuses and computes testability', async () => {
    const { dir } = await fixtureRepo();
    const loaded = await loadDecisionDirectory(dir);
    const decisions = await runAll(loaded.decisions, { file_match: async () => ({ passed: true, evidence: 'ok' }) });
    const report = buildRunnerReport(decisions, loaded.errors.length);

    expect(report.total).toBe(1);
    expect(report.enforced).toBe(1);
    expect(report.parseErrors).toBe(1);
    expect(report.testability).toBe(1);
    expect(report.statuses).toHaveLength(1);
  });

  it('renders a readable text report', async () => {
    const { dir } = await fixtureRepo();
    const loaded = await loadDecisionDirectory(dir);
    const decisions = await runAll(loaded.decisions, { file_match: async () => ({ passed: true, evidence: 'ok' }) });
    const text = formatText(buildRunnerReport(decisions, loaded.errors.length));
    expect(text).toMatch(/decisions: 1/);
    expect(text).toMatch(/enforced: 1/);
  });
});

describe('repository corpus consistency', () => {
  it('keeps the example repo and the app seed in step', async () => {
    const loaded = await loadDecisionDirectory('examples/decision-repo/.decisions');
    const seed = loadSeedDecisions();

    expect(loaded.errors).toEqual([]);
    expect(loaded.decisions.map((d) => d.id).sort()).toEqual(seed.map((d) => d.id).sort());
    expect(loaded.decisions.every((d) => d.domain.length > 0)).toBe(true);
  });

  it('produces the same statuses from files as from the seed fixture', async () => {
    const loaded = await loadDecisionDirectory('examples/decision-repo/.decisions');
    const fromFiles = await runAll(
      loaded.decisions,
      createHostExecutors({ root: 'examples/decision-repo' }),
    );
    const fromSeed = await runAll(loadSeedDecisions(), createFixtureExecutors());

    expect(fromFiles.map((d) => `${d.id}:${d.status}`).sort()).toEqual(
      fromSeed.map((d) => `${d.id}:${d.status}`).sort(),
    );
  });
});
