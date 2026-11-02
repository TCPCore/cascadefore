import type { Evidence, Iso } from '../shared/types';
import { RECENCY_FLOOR, RECENCY_HALF_LIFE_DAYS } from './constants';
import { clamp } from './math';

const DAY_MS = 86_400_000;

/**
 * The time gate.
 *
 * A piece of evidence is "knowable" at a decision if it existed when the
 * decision was made. This single comparison is the entire defence against the
 * hindsight-bias objection, and it must stay this small to stay auditable.
 */
export function isKnowable(evidence: Evidence, decidedAt: Iso): boolean {
  const created = Date.parse(evidence.createdAt);
  const decided = Date.parse(decidedAt);
  if (Number.isNaN(created) || Number.isNaN(decided)) return false;
  return created <= decided;
}

/** Age in days, floored at 0 (clock skew on graph timestamps is common). */
export function ageInDays(from: Iso, to: Iso): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, (b - a) / DAY_MS);
}

/**
 * Exponential decay, floored so that very old but structurally important
 * evidence (a founding ADR) still contributes rather than vanishing.
 */
export function recencyWeight(
  createdAt: Iso,
  decidedAt: Iso,
  halfLifeDays: number = RECENCY_HALF_LIFE_DAYS,
): number {
  const age = ageInDays(createdAt, decidedAt);
  return clamp(Math.exp(-age / halfLifeDays), RECENCY_FLOOR, 1);
}

export interface KnowabilitySplit {
  knowable: Evidence[];
  withheld: Evidence[];
}

export function splitByKnowability(evidence: readonly Evidence[], decidedAt: Iso): KnowabilitySplit {
  const knowable: Evidence[] = [];
  const withheld: Evidence[] = [];
  for (const e of evidence) {
    if (isKnowable(e, decidedAt)) knowable.push(e);
    else withheld.push(e);
  }
  return { knowable, withheld };
}

/** true when the evidence has been superseded on or before `now`. */
export function isSuperseded(evidence: Evidence, now: Iso): boolean {
  if (!evidence.supersededAt) return false;
  const s = Date.parse(evidence.supersededAt);
  const n = Date.parse(now);
  if (Number.isNaN(s) || Number.isNaN(n)) return false;
  return s <= n;
}
