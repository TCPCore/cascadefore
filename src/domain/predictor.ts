/**
 * Deterministic success estimator.
 *
 * Turns countable facts into a probability, with no model, no sampling and no
 * randomness: the same input always yields the same output, and every term in
 * the arithmetic is inspectable.
 *
 * The honest claim it supports:
 *
 *   "Among comparable decisions in this organisation, paths like this one
 *    succeeded r of n times. Adjusting for what is currently known and what
 *    moving would cost, the estimate is p."
 *
 * The claim it does NOT support — and must never be presented as:
 *
 *   "Had you chosen this, you would have succeeded p% of the time."
 *
 * A probability of the second kind requires an outcome distribution over
 * counterfactual worlds. We do not have one, and inventing it is how this class
 * of tool becomes dishonest.
 */

export type Grade = 'A' | 'B' | 'C';

export interface PredictorFeatures {
  /** Observed outcomes for comparable decisions that took this path. */
  precedentWins: number;
  precedentTrials: number;
  /** Share of relevant evidence that predates the decision. */
  knowability: number;
  /** Share of required dependencies still resolvable today. */
  applicability: number;
  /** Share of evidence not superseded. */
  freshness: number;
  /** Normalised cost of switching to this path. */
  migrationCost: number;
  /** `intentFit` from the intent policy. */
  intentFit: number;
}

export interface Driver {
  label: string;
  /** Feature value actually used, after clamping. */
  value: number;
  /** Log-odds contribution. */
  contribution: number;
}

export interface Prediction {
  probability: number;
  /** How favourable the current facts are, before any precedent is considered. */
  factAssessment: number;
  /** Weight given to observed precedent, 0..1 — grows with sample size. */
  evidenceWeight: number;
  /** Deterministic interval from the precedent sample, widened for thin data. */
  interval: [number, number];
  grade: Grade;
  evidenceCount: number;
  baseRate: number;
  drivers: Driver[];
  /** Present when the sample is too thin to call the number evidence. */
  caveat: string | null;
}

/**
 * Fixed coefficients. Deliberately hand-set and documented rather than fitted:
 * we have no labelled corpus to fit on, and a fitted model on six decisions
 * would be overfitting dressed as rigour. These encode stated beliefs about
 * direction and relative weight, nothing more.
 */
export const COEFFICIENTS = {
  knowability: 0.9,
  applicability: 1.1,
  freshness: 0.4,
  migration: 0.8,
  intentFit: 0.7,
} as const;

const LOGIT_CLAMP = 3;

/** Counts are untrusted: NaN, negatives and fractions all collapse to a safe int. */
function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function logit(p: number): number {
  const safe = Math.min(0.999, Math.max(0.001, p));
  return Math.log(safe / (1 - safe));
}

/**
 * Laplace-smoothed base rate. Two pseudo-observations at 0.5, so 0 of 0 reads
 * 0.5 with no confidence rather than 0 or 1.
 */
export function baseRate(wins: number, trials: number): number {
  const w = count(wins);
  const n = Math.max(w, count(trials));
  return (w + 1) / (n + 2);
}

/**
 * Wilson score interval for the observed rate — the interval a practitioner
 * would put on "r of n" without pretending a small sample is precise.
 */
export function wilsonInterval(wins: number, trials: number, z = 1.96): [number, number] {
  const n = count(trials);
  if (n === 0) return [0, 1];

  const p = Math.min(1, Math.max(0, count(wins) / n));
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [clamp01((centre - spread) / denom), clamp01((centre + spread) / denom)];
}

export function gradeFor(trials: number): Grade {
  const n = count(trials);
  if (n >= 8) return 'A';
  if (n >= 3) return 'B';
  return 'C';
}

/**
 * The model is a **weighted blend**, not an additive log-odds sum.
 *
 * An additive model lets a handful of favourable facts overwhelm a poor observed
 * rate: 1 win in 6 with perfect applicability scored 0.897, which is nonsense —
 * the evidence says the path fails five times in six. Blend instead:
 *
 *   factAssessment = logistic(Σ wᵢ · 2(fᵢ − 0.5))     how good things look now
 *   evidenceWeight = n / (n + 4)                        how much precedent to trust
 *   probability    = evidenceWeight·base + (1 − evidenceWeight)·factAssessment
 *
 * With no precedent the answer is the fact assessment, and grade C says so out
 * loud. With a large sample the observed rate dominates, which is the direction
 * evidence should push.
 */
export function estimateSuccess(features: PredictorFeatures): Prediction {
  const wins = count(features.precedentWins);
  const trials = Math.max(wins, count(features.precedentTrials));
  const grade = gradeFor(trials);

  const known = clamp01(features.knowability);
  const applicable = clamp01(features.applicability);
  const fresh = clamp01(features.freshness);
  const migration = clamp01(features.migrationCost);
  const fit = clamp01(features.intentFit);

  const entries: Array<[string, number, number]> = [
    ['knowability', known, (known - 0.5) * 2 * COEFFICIENTS.knowability],
    ['applicability', applicable, (applicable - 0.5) * 2 * COEFFICIENTS.applicability],
    ['freshness', fresh, (fresh - 0.5) * 2 * COEFFICIENTS.freshness],
    ['migrationCost', migration, -(migration - 0.5) * 2 * COEFFICIENTS.migration],
    ['intentFit', fit, (fit - 0.5) * 2 * COEFFICIENTS.intentFit],
  ];

  const rawFeature = entries.reduce((total, [, , contribution]) => total + contribution, 0);
  const factAssessment = logistic(Math.max(-LOGIT_CLAMP, Math.min(LOGIT_CLAMP, rawFeature)));

  const base = baseRate(wins, trials);
  const evidenceWeight = trials / (trials + 4);
  const probability = evidenceWeight * base + (1 - evidenceWeight) * factAssessment;

  const [lo, hi] = wilsonInterval(wins, trials);
  const widen = grade === 'A' ? 0 : grade === 'B' ? 0.08 : 0.2;

  return {
    probability: Math.round(probability * 1000) / 1000,
    factAssessment: Math.round(factAssessment * 1000) / 1000,
    evidenceWeight: Math.round(evidenceWeight * 1000) / 1000,
    interval: [clamp01(lo - widen), clamp01(hi + widen)].map(
      (v) => Math.round(v * 1000) / 1000,
    ) as [number, number],
    grade,
    evidenceCount: trials,
    baseRate: Math.round(base * 1000) / 1000,
    drivers: entries.map(([label, value, contribution]) => ({
      label,
      value: Math.round(value * 1000) / 1000,
      contribution: Math.round(contribution * 1000) / 1000,
    })),
    caveat:
      grade === 'C'
        ? `Only ${trials} comparable precedent(s). The number is the current-fact assessment, not evidence.`
        : null,
  };
}

/**
 * Whether an outcome label is trustworthy enough to enter a base rate.
 * A "success" nobody observed is not a data point.
 */
export function isUsableOutcome(label: string): boolean {
  return label === 'tried_ok' || label === 'tried_bad';
}
