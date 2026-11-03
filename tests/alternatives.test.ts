import { describe, expect, it } from 'vitest';

import {
  extractRejectedAlternatives,
  findCounterfactual,
  type PrecedentDecision,
  type ProseComment,
} from '../src/decisions/alternatives';

const DECIDED = '2022-03-26T00:21:59.292Z';

function comment(body: string, createdAt = '2022-03-26T00:15:54.357Z'): ProseComment {
  return { ari: `ari:comment/${createdAt}`, body, createdAt };
}

describe('rejected-alternative extraction', () => {
  it('pulls the alternative and its reason out of ordinary prose', () => {
    const found = extractRejectedAlternatives(
      [comment('We considered MongoDB but weak ACID at the time, so no.')],
      DECIDED,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.name.toLowerCase()).toContain('mongodb');
    expect(found[0]?.rejected_because?.toLowerCase()).toContain('acid');
  });

  it('handles the "not X because Y" form', () => {
    const found = extractRejectedAlternatives([comment('not SQLite because no concurrent writers')], DECIDED);
    expect(found[0]?.name.toLowerCase()).toContain('sqlite');
    expect(found[0]?.rejected_because).toMatch(/concurrent writers/i);
  });

  it('handles "rejected X" with an em-dash reason', () => {
    const found = extractRejectedAlternatives([comment('we rejected DynamoDB — vendor lock-in')], DECIDED);
    expect(found[0]?.name.toLowerCase()).toContain('dynamodb');
    expect(found[0]?.rejected_because).toMatch(/lock-in/i);
  });

  it('records a rejection with no stated reason rather than inventing one', () => {
    const found = extractRejectedAlternatives([comment('we ruled out a separate search cluster')], DECIDED);
    expect(found).toHaveLength(1);
    expect(found[0]?.rejected_because).toBeNull();
  });

  it('extracts nothing from prose that contains no rejection', () => {
    const found = extractRejectedAlternatives(
      [
        comment('Would that be you?'),
        comment('we need to add Finance to the list here'),
        comment('Yes, for now. We should be getting a dedicated headcount next quarter', DECIDED),
      ],
      DECIDED,
    );
    expect(found).toEqual([]);
  });

  it('applies the time gate: knowableAt is never after the decision', () => {
    const late = comment('we rejected the sharded option because migration cost', '2023-01-01T00:00:00.000Z');
    const found = extractRejectedAlternatives([late], DECIDED);
    expect(found[0]?.knowableAt).toBe(DECIDED);
  });

  it('deduplicates the same alternative, keeping the reasoned copy', () => {
    const found = extractRejectedAlternatives(
      [
        comment('we considered MongoDB but no', '2022-01-01T00:00:00.000Z'),
        comment('we considered MongoDB but weak ACID', '2022-02-01T00:00:00.000Z'),
      ],
      DECIDED,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.rejected_because).toMatch(/acid/i);
  });
});

describe('precedent-based counterfactual', () => {
  const alternative = extractRejectedAlternatives(
    [comment('We considered MongoDB but weak ACID')],
    DECIDED,
  )[0]!;

  const corpus: PrecedentDecision[] = [
    {
      id: '0019',
      title: 'MongoDB for ledger events',
      decidedAt: '2023-06-01T00:00:00.000Z',
      domain: ['datastore'],
      alternatives: [{ name: 'MongoDB', outcome: 'tried_bad' }],
    },
    {
      id: '0044',
      title: 'MongoDB for telemetry ingestion',
      decidedAt: '2024-01-15T00:00:00.000Z',
      domain: ['datastore'],
      alternatives: [{ name: 'MongoDB', outcome: 'tried_ok' }],
    },
    {
      id: '0012',
      title: 'Postgres as primary datastore',
      decidedAt: '2021-03-14T00:00:00.000Z',
      domain: ['datastore'],
      alternatives: [{ name: 'MongoDB', outcome: 'never_tried' }],
    },
  ];

  it('splits precedent into what was known then and what was learned later', () => {
    const result = findCounterfactual(alternative, corpus, DECIDED);

    // Nothing was tried before 2022-03: 0012 only considered it.
    expect(result.knownThen).toHaveLength(0);
    expect(result.learnedLater.map((p) => p.decisionId).sort()).toEqual(['0019', '0044']);
  });

  it('states the honest summary when no precedent existed', () => {
    const result = findCounterfactual(alternative, corpus, DECIDED);
    expect(result.summary).toMatch(/no precedent/i);
    expect(result.summary).toMatch(/documentation/i);
  });

  it('moves a precedent into knownThen when it predates the decision', () => {
    const earlier: PrecedentDecision[] = [
      {
        id: '0005',
        title: 'MongoDB for audit logs',
        decidedAt: '2020-01-01T00:00:00.000Z',
        domain: ['datastore'],
        alternatives: [{ name: 'MongoDB', outcome: 'tried_ok' }],
      },
    ];
    const result = findCounterfactual(alternative, earlier, DECIDED);
    expect(result.knownThen).toHaveLength(1);
    expect(result.knownThen[0]?.outcome).toBe('held');
    expect(result.summary).toMatch(/already had 1 precedent/i);
  });

  it('classifies outcomes from what the precedent tried', () => {
    const result = findCounterfactual(alternative, corpus, DECIDED);
    const byId = new Map(result.learnedLater.map((p) => [p.decisionId, p.outcome]));
    expect(byId.get('0019')).toBe('reverted');
    expect(byId.get('0044')).toBe('held');
  });

  it('explains why each precedent is relevant', () => {
    const result = findCounterfactual(alternative, corpus, DECIDED);
    for (const precedent of [...result.knownThen, ...result.learnedLater]) {
      expect(precedent.because.length).toBeGreaterThan(0);
    }
  });
});
