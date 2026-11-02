import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTENT,
  detectConstraintTags,
  detectHorizon,
  intentFit,
  normaliseIntent,
  parseIntentLocally,
} from '../src/domain/intent';

describe('constraint tags', () => {
  it('extracts machine-readable tags from free text', () => {
    const tags = detectConstraintTags([
      'must not add a new dependency #no-new-dependency',
      'ship inside the sprint #ship-within-2-weeks',
    ]);
    expect(tags).toEqual(['no-new-dependency', 'ship-within-2-weeks']);
  });

  it('ignores untagged prose rather than guessing', () => {
    expect(detectConstraintTags(['must satisfy the auditors'])).toEqual([]);
  });

  it('de-duplicates repeated tags', () => {
    const tags = detectConstraintTags(['#no-downtime please', 'and #no-downtime again']);
    expect(tags).toEqual(['no-downtime']);
  });
});

describe('horizon detection', () => {
  it.each([
    ['restore service this week', 'weeks'],
    ['stabilise through next quarter', 'quarters'],
    ['reduce long-term maintenance burden', 'years'],
    ['make it maintainable over the year', 'years'],
  ] as const)('%s → %s', (text, expected) => {
    expect(detectHorizon(text)).toBe(expected);
  });

  it('falls back when nothing matches', () => {
    expect(detectHorizon('do the thing', 'quarters')).toBe('quarters');
  });
});

describe('local intent parser', () => {
  it('separates goal, constraints and success criteria', () => {
    const intent = parseIntentLocally(
      [
        'Restore checkout reliability.',
        'We must not add a new dependency #no-new-dependency.',
        'Success means the p99 latency stays under 300ms.',
        'Out of scope: rewriting the ledger.',
      ].join('\n'),
    );
    expect(intent.goal).toMatch(/checkout reliability/i);
    expect(intent.hardConstraints).toHaveLength(1);
    expect(intent.successCriteria).toHaveLength(1);
    expect(intent.nonGoals).toHaveLength(1);
    expect(intent.source).toBe('user');
  });

  it('never returns an empty goal', () => {
    expect(parseIntentLocally('').goal).toBe(DEFAULT_INTENT.goal);
  });

  it('respects an explicitly supplied horizon', () => {
    expect(parseIntentLocally('restore service this week', 'years').horizon).toBe('years');
  });
});

describe('normaliseIntent', () => {
  it('fills gaps without inventing constraints', () => {
    const intent = normaliseIntent({ goal: 'ship it' });
    expect(intent.goal).toBe('ship it');
    expect(intent.hardConstraints).toEqual([]);
    expect(intent.horizon).toBe('weeks');
  });

  it('falls back to the default goal when blank', () => {
    expect(normaliseIntent({ goal: '   ' }).goal).toBe(DEFAULT_INTENT.goal);
  });
});

describe('intent fit policy', () => {
  const facts = { migrationCost: 0.5, residualRisk: 0.2, freshness: 1 };

  it('penalises migration cost more on a short horizon', () => {
    const weeks = intentFit({ ...DEFAULT_INTENT, horizon: 'weeks' }, facts);
    const years = intentFit({ ...DEFAULT_INTENT, horizon: 'years' }, facts);
    expect(weeks.value).toBeLessThan(years.value);
  });

  it('penalises residual risk more on a long horizon', () => {
    const risky = { migrationCost: 0, residualRisk: 0.8, freshness: 1 };
    const weeks = intentFit({ ...DEFAULT_INTENT, horizon: 'weeks' }, risky);
    const years = intentFit({ ...DEFAULT_INTENT, horizon: 'years' }, risky);
    expect(years.value).toBeLessThan(weeks.value);
  });

  it('exposes the weights it used', () => {
    const fit = intentFit({ ...DEFAULT_INTENT, horizon: 'quarters' }, facts);
    expect(fit.weights).toEqual({ migration: 0.4, residual: 0.4, freshness: 0.2 });
    expect(fit.expression).toContain('1 −');
  });

  it('stays within 0..1', () => {
    const extreme = { migrationCost: 1, residualRisk: 1, freshness: 0 };
    expect(intentFit(DEFAULT_INTENT, extreme).value).toBeGreaterThanOrEqual(0);
    expect(intentFit(DEFAULT_INTENT, extreme).value).toBeLessThanOrEqual(1);
  });
});
