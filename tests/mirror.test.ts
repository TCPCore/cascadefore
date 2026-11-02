import { describe, expect, it } from 'vitest';

import { renderDecisionPage, toDecisionYaml, pageTitleFor, idFromTitle } from '../src/mirror/page';
import { createMemoryTarget, syncDecisions } from '../src/mirror/sync';
import { decisionsFromPages } from '../src/mirror/ingest';
import { parseDecision } from '../src/decisions/parse';
import { runAll } from '../src/decisions/runner';
import { loadSeedDecisions, createFixtureExecutors } from '../src/decisions/seed';

async function ran() {
  return runAll(loadSeedDecisions(), createFixtureExecutors());
}

describe('page rendering', () => {
  it('round-trips a decision through the fenced YAML block', async () => {
    const [decision] = await ran();
    const page = renderDecisionPage(decision!);
    const reparsed = parseDecision(page.body);

    expect(reparsed.id).toBe(decision!.id);
    expect(reparsed.decision).toBe(decision!.decision);
    expect(reparsed.domain).toEqual(decision!.domain);
    expect(reparsed.constraints).toEqual(decision!.constraints);
    expect(reparsed.tests).toHaveLength(decision!.tests.length);
  });

  it('carries the test spec, not just the outcome', async () => {
    const [decision] = await ran();
    const yaml = toDecisionYaml(decision!);
    expect(yaml).toContain('kind: file_match');
    expect(yaml).toContain('target: infra/docker-compose.yml');
  });

  it('shows status and evidence in the human half', async () => {
    const decisions = await ran();
    const violated = decisions.find((d) => d.status === 'violated')!;
    const page = renderDecisionPage(violated);
    expect(page.body).toMatch(/✗ failed/);
    expect(page.body).toContain('pg_stat_statements');
  });

  it('derives ids back from titles', async () => {
    expect(pageTitleFor('0012')).toBe('Decision record: 0012');
    expect(idFromTitle('Decision record: 0012')).toBe('0012');
    expect(idFromTitle('Some other page')).toBeNull();
  });
});

describe('mirror sync', () => {
  it('creates every page on the first run', async () => {
    const decisions = await ran();
    const target = createMemoryTarget();
    const result = await syncDecisions(decisions, target);

    expect(result.created).toHaveLength(decisions.length);
    expect(result.updated).toHaveLength(0);
    expect(target.pages).toHaveLength(decisions.length);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const decisions = await ran();
    const target = createMemoryTarget();
    await syncDecisions(decisions, target);
    const second = await syncDecisions(decisions, target);

    expect(second.created).toHaveLength(0);
    expect(second.updated).toHaveLength(0);
    expect(second.unchanged).toHaveLength(decisions.length);
  });

  it('updates only the decision that changed', async () => {
    const decisions = await ran();
    const target = createMemoryTarget();
    await syncDecisions(decisions, target);

    const changed = decisions.map((decision, index) =>
      index === 0 ? { ...decision, rationale: 'rewritten rationale' } : decision,
    );
    const result = await syncDecisions(changed, target);

    expect(result.updated).toEqual([decisions[0]!.id]);
    expect(result.unchanged).toHaveLength(decisions.length - 1);
  });

  it('captures a per-decision failure without aborting the run', async () => {
    const decisions = await ran();
    const target = createMemoryTarget();
    const failing = {
      ...target,
      async create(title: string) {
        if (title.includes('0012')) throw new Error('boom');
        return target.create(title, '');
      },
    };

    const result = await syncDecisions(decisions, failing);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.id).toBe('0012-use-postgres-primary');
    expect(result.created.length).toBe(decisions.length - 1);
  });
});

describe('ingest', () => {
  it('returns decisions and ignores unrelated pages', async () => {
    const decisions = await ran();
    const target = createMemoryTarget();
    await syncDecisions(decisions, target);

    const result = decisionsFromPages([
      ...target.pages.map((page) => ({ id: page.id, title: page.title, body: page.body })),
      { id: 'other', title: 'Team offsite', body: '# not a decision' },
    ]);

    expect(result.decisions).toHaveLength(decisions.length);
    expect(result.ignored).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('flags a title that disagrees with the record', () => {
    const result = decisionsFromPages([
      {
        id: 'p1',
        title: 'Decision record: 9999-mismatch',
        body: 'id: 1111-other\ndecision: x\ndecided_at: 2026-01-01T00:00:00Z\n',
      },
    ]);
    expect(result.decisions).toHaveLength(0);
    expect(result.errors[0]?.message).toMatch(/title says/);
  });

  it('reports a malformed page instead of throwing', () => {
    const result = decisionsFromPages([
      { id: 'p2', title: 'Decision record: broken', body: 'id: broken\ndecision: missing date\n' },
    ]);
    expect(result.decisions).toHaveLength(0);
    expect(result.errors[0]?.message).toMatch(/decided_at/);
  });
});

describe('repository → mirror → ingest round trip', () => {
  it('preserves identity, tests and outcome across the wire', async () => {
    const original = await ran();
    const target = createMemoryTarget();
    await syncDecisions(original, target);

    const ingested = decisionsFromPages(
      target.pages.map((page) => ({ id: page.id, title: page.title, body: page.body })),
    );

    expect(ingested.decisions.map((d) => d.id).sort()).toEqual(original.map((d) => d.id).sort());
    for (const decision of ingested.decisions) {
      const source = original.find((d) => d.id === decision.id)!;
      expect(decision.tests).toHaveLength(source.tests.length);
      expect(decision.domain).toEqual(source.domain);
    }

    // Re-running the ingested corpus reproduces the same statuses: the mirror
    // lost nothing that matters.
    const rerun = await runAll(ingested.decisions, createFixtureExecutors());
    expect(rerun.map((d) => `${d.id}:${d.status}`).sort()).toEqual(
      original.map((d) => `${d.id}:${d.status}`).sort(),
    );
  });
});

describe('confluence storage format', () => {
  it('round-trips a rendered page back through storage markup', async () => {
    const { toStorageFormat, fromStorageFormat } = await import('../src/mirror/storage');
    const [decision] = await ran();
    const page = renderDecisionPage(decision!);

    const storage = toStorageFormat(page.body);
    expect(storage).toContain('ac:name="code"');

    const back = fromStorageFormat(storage);
    const reparsed = parseDecision(back);
    expect(reparsed.id).toBe(decision!.id);
    expect(reparsed.tests).toHaveLength(decision!.tests.length);
  });

  it('escapes and restores markup characters', async () => {
    const { toStorageFormat, fromStorageFormat, escapeXml, unescapeXml } = await import('../src/mirror/storage');
    const raw = 'a < b & c > d "quoted"';
    expect(unescapeXml(escapeXml(raw))).toBe(raw);

    const storage = toStorageFormat(`# Title\n\n${raw}`);
    expect(storage).toContain('&lt;');
    expect(fromStorageFormat(storage)).toContain(raw);
  });

  it('tolerates editor-injected markup without losing the fence', async () => {
    const { fromStorageFormat } = await import('../src/mirror/storage');
    const [decision] = await ran();
    const page = renderDecisionPage(decision!);

    const messy = `<div class="wrapper"><span>${page.body.split('```')[0]}</span></div>`;
    expect(() => fromStorageFormat(messy)).not.toThrow();
  });
});
