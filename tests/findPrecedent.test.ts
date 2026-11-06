import { describe, expect, it } from 'vitest';

import { findPrecedentFor } from '../src/actions/findPrecedent';

describe('find-precedent primitive', () => {
  it('says plainly when nothing was known at the time and never guesses', () => {
    const result = findPrecedentFor({ alternativeText: 'MongoDB', asOf: '2022-01-01T00:00:00.000Z' });
    expect(result.summary).toMatch(/no precedent|already had/i);
    expect(result.learnedLater.every((p) => p.decidedAt > '2022-01-01T00:00:00.000Z')).toBe(true);
  });

  it('marks each precedent with whether it was knowable at the decision', () => {
    const result = findPrecedentFor({ alternativeText: 'MongoDB', asOf: '2030-01-01T00:00:00.000Z' });
    for (const row of [...result.knownThen, ...result.learnedLater]) {
      expect(typeof row.knowableAtOriginalDecision).toBe('boolean');
    }
    expect(result.knownThen.every((p) => p.knowableAtOriginalDecision)).toBe(true);
    expect(result.learnedLater.every((p) => !p.knowableAtOriginalDecision)).toBe(true);
  });

  it('asks for the alternative instead of inventing one', () => {
    const result = findPrecedentFor({});
    expect(result.summary).toMatch(/no alternative named/i);
    expect(result.knownThen).toHaveLength(0);
  });

  it('filters by area without changing the time gate', () => {
    const all = findPrecedentFor({ alternativeText: 'MongoDB', asOf: '2030-01-01T00:00:00.000Z' });
    const datastore = findPrecedentFor({ alternativeText: 'MongoDB', area: 'datastore', asOf: '2030-01-01T00:00:00.000Z' });
    expect(datastore.knownThen.length).toBeLessThanOrEqual(all.knownThen.length);
  });
});
