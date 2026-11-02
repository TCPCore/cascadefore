import { describe, expect, it } from 'vitest';
import {
  ageInDays,
  isKnowable,
  isSuperseded,
  recencyWeight,
  splitByKnowability,
} from '../src/domain/timeGate.js';
import { ev } from './fixtures/scenario.js';

describe('time gate', () => {
  const decidedAt = '2026-03-14T09:12:00.000Z';

  it('treats evidence created before the decision as knowable', () => {
    expect(isKnowable(ev('a', 'confluence-page', '2026-03-01T00:00:00.000Z'), decidedAt)).toBe(true);
  });

  it('treats evidence created after the decision as not knowable', () => {
    expect(isKnowable(ev('b', 'confluence-page', '2026-03-15T00:00:00.000Z'), decidedAt)).toBe(false);
  });

  it('treats evidence created at the exact decision instant as knowable', () => {
    expect(isKnowable(ev('c', 'confluence-page', decidedAt), decidedAt)).toBe(true);
  });

  it('fails closed on unparseable timestamps', () => {
    expect(isKnowable(ev('d', 'confluence-page', 'not-a-date'), decidedAt)).toBe(false);
  });

  it('splits evidence into knowable and withheld piles', () => {
    const split = splitByKnowability(
      [
        ev('e1', 'confluence-page', '2026-01-01T00:00:00.000Z'),
        ev('e2', 'confluence-page', '2026-06-01T00:00:00.000Z'),
      ],
      decidedAt,
    );
    expect(split.knowable).toHaveLength(1);
    expect(split.withheld).toHaveLength(1);
  });

  it('decays recency but never below the floor', () => {
    const fresh = recencyWeight(decidedAt, decidedAt);
    const old = recencyWeight('2019-01-01T00:00:00.000Z', decidedAt);
    expect(fresh).toBeCloseTo(1, 5);
    expect(old).toBeGreaterThanOrEqual(0.2);
    expect(old).toBeLessThan(fresh);
  });

  it('floors negative ages at zero (clock skew)', () => {
    expect(ageInDays('2026-03-20T00:00:00.000Z', '2026-03-14T00:00:00.000Z')).toBe(0);
  });

  it('detects superseded evidence relative to now', () => {
    const e = ev('f', 'confluence-page', '2026-01-01T00:00:00.000Z', {
      supersededAt: '2026-09-01T00:00:00.000Z',
    });
    expect(isSuperseded(e, '2026-10-01T00:00:00.000Z')).toBe(true);
    expect(isSuperseded(e, '2026-08-01T00:00:00.000Z')).toBe(false);
  });
});
