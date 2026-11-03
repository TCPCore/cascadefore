import type { BranchScore, PathCandidate } from '../shared/types';
import { estimateSuccess, type Prediction } from './predictor';

/**
 * Forecast for one reconstructed path.
 *
 * This is additive: it reads the score and facts the engine already produces and
 * returns a prediction. It changes nothing upstream, and a path without a
 * forecast behaves exactly as before.
 *
 * Precedent counts are passed in rather than looked up, so this stays pure and
 * the caller decides what counts as a comparable decision. With no precedent the
 * number is the fact assessment and is labelled as such — grade C, with a
 * caveat — rather than quietly presented as probability.
 */
export interface PrecedentCounts {
  /** Comparable decisions that took this kind of path and were observed to hold. */
  wins: number;
  /** Comparable decisions that took it and were observed, period. */
  trials: number;
}

export const NO_PRECEDENT: PrecedentCounts = { wins: 0, trials: 0 };

/** Only the fields the forecaster reads — nothing else is required of a path. */
export type ForecastablePath = Pick<PathCandidate, 'pathId' | 'branchId' | 'label' | 'facts'>;

export interface PathForecast {
  pathId: string;
  branchId: string;
  label: string;
  prediction: Prediction;
}

export function predictForPath(
  path: ForecastablePath,
  score: Pick<BranchScore, 'knowability'>,
  precedent: PrecedentCounts,
): PathForecast {
  return {
    pathId: path.pathId,
    branchId: path.branchId,
    label: path.label,
    prediction: estimateSuccess({
      precedentWins: precedent.wins,
      precedentTrials: precedent.trials,
      knowability: score.knowability,
      applicability: path.facts.applicability,
      freshness: path.facts.freshness,
      migrationCost: path.facts.migrationCost,
      intentFit: path.facts.intentFit,
    }),
  };
}

/**
 * Joins the two halves of a stored run — paths carry the facts, branches carry
 * the knowability score — and forecasts each one.
 */
export function forecastRun(
  paths: readonly ForecastablePath[],
  scores: ReadonlyArray<{ branchId: string; knowability: number }>,
  precedent: PrecedentCounts = NO_PRECEDENT,
): PathForecast[] {
  const byBranch = new Map(scores.map((s) => [s.branchId, s.knowability]));

  return paths
    .filter((path) => byBranch.has(path.branchId))
    .map((path) => predictForPath(path, { knowability: byBranch.get(path.branchId)! }, precedent))
    .sort((a, b) => b.prediction.probability - a.prediction.probability);
}
