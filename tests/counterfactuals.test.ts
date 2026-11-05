import { describe, expect, it } from 'vitest';

import { buildCorpusCounterfactuals } from '../src/decisions/counterfactuals';
import { loadSeedDecisions } from '../src/decisions/seed';

describe('paths not taken, from decision records', () => {
  const corpus = loadSeedDecisions();

  it('finds the rejections the records actually carry', () => {
    const rows = buildCorpusCounterfactuals(corpus);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => /sqlite/i.test(r.name))).toBe(true);
    expect(rows.some((r) => /mongodb/i.test(r.name))).toBe(true);
  });

  it('carries the reason the team gave, not an invented one', () => {
    const rows = buildCorpusCounterfactuals(corpus);
    const mongodb = rows.find((r) => /mongodb/i.test(r.name));
    expect(mongodb?.rejectedBecause).toMatch(/acid/i);
  });

  it('applies the time gate against a known-before and known-after precedent', () => {
    const base = {
      decidedBy: [],
      constraints: [],
      rationale: '',
      alternatives: [],
      tests: [],
      links: [],
      status: 'enforced' as const,
      results: [],
      lastRunAt: null,
    };

    const target = {
      ...base,
      id: 'target',
      decision: 'Use Postgres for the ledger',
      decidedAt: '2022-01-01T00:00:00.000Z',
      domain: ['datastore'],
      alternatives: [
        { name: 'MongoDB', rejected_because: 'weak ACID', outcome: 'never_tried' as const },
      ],
    };

    const before = {
      ...base,
      id: 'before',
      decision: 'MongoDB for audit logs',
      decidedAt: '2020-01-01T00:00:00.000Z',
      domain: ['datastore'],
      alternatives: [{ name: 'MongoDB', outcome: 'tried_ok' as const }],
    };

    const after = {
      ...base,
      id: 'after',
      decision: 'MongoDB for telemetry',
      decidedAt: '2024-01-01T00:00:00.000Z',
      domain: ['datastore'],
      alternatives: [{ name: 'MongoDB', outcome: 'tried_bad' as const }],
    };

    const rows = buildCorpusCounterfactuals([target, before, after]);
    const row = rows.find((r) => r.name === 'MongoDB')!;

    // The 2020 precedent existed when the decision was made; the 2024 one did not.
    expect(row.knownThen.map((p) => p.decisionId)).toEqual(['before']);
    expect(row.learnedLater.map((p) => p.decisionId)).toEqual(['after']);
    expect(row.summary).toMatch(/already had 1 precedent/i);
  });

  it('says plainly when the organisation had no precedent', () => {
    const rows = buildCorpusCounterfactuals(corpus);
    const mongodb = rows.find((r) => /mongodb/i.test(r.name));
    expect(mongodb?.summary).toMatch(/no precedent|already had/i);
  });

  it('skips alternatives with no stated reason rather than padding the list', () => {
    const rows = buildCorpusCounterfactuals(corpus);
    expect(rows.every((r) => r.rejectedBecause)).toBe(true);
  });
});

describe('precedent hygiene', () => {
  it('never counts a decision as its own precedent', () => {
    const rows = buildCorpusCounterfactuals(loadSeedDecisions());
    for (const row of rows) {
      expect(row.knownThen.some((p) => p.decisionId === row.decisionId)).toBe(false);
      expect(row.learnedLater.some((p) => p.decisionId === row.decisionId)).toBe(false);
    }
  });

  it('does not treat "unknown outcome" as a trial', () => {
    // 0012 rejected MongoDB with outcome "unknown" — nobody ran that experiment,
    // so it must not appear as evidence anywhere.
    const rows = buildCorpusCounterfactuals(loadSeedDecisions());
    const mongodb = rows.find((r) => /mongodb/i.test(r.name))!;
    expect(mongodb.knownThen).toHaveLength(0);
    expect(mongodb.summary).toMatch(/no precedent/i);
  });
});
