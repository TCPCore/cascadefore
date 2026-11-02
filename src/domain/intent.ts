import type { Horizon, Intent, IntentFitBreakdown, PathFacts } from '../shared/types.js';
import { INTENT_WEIGHTS } from './constants.js';
import { clamp01 } from './math.js';

export const DEFAULT_INTENT: Intent = {
  goal: 'Restore the build and reduce the chance of repeating this failure',
  successCriteria: [],
  hardConstraints: [],
  softPreferences: [],
  nonGoals: [],
  horizon: 'weeks',
  source: 'inferred',
};

const HORIZON_HINTS: Array<{ match: RegExp; horizon: Horizon }> = [
  { match: /\b(this|next)\s+(week|sprint)\b|\bhotfix\b|\bincident\b|\brestore\b/i, horizon: 'weeks' },
  { match: /\bquarter\b|\broadmap\b|\bnext\s+(release|cycle)\b/i, horizon: 'quarters' },
  { match: /\byear\b|\blong[-\s]?term\b|\bmaintainab/i, horizon: 'years' },
];

/**
 * Machine-readable tags a user can append to a hard constraint so the engine
 * can veto deterministically. Unrecognised constraints never veto — they are
 * reported as unmapped instead of silently pretending to be understood.
 */
export const CONSTRAINT_TAGS = {
  'no-new-dependency': '#no-new-dependency',
  'ship-within-2-weeks': '#ship-within-2-weeks',
  'no-schema-change': '#no-schema-change',
  'no-downtime': '#no-downtime',
} as const;

export type ConstraintTag = keyof typeof CONSTRAINT_TAGS;

export function detectConstraintTags(constraints: readonly string[]): ConstraintTag[] {
  const tags: ConstraintTag[] = [];
  for (const c of constraints) {
    for (const tag of Object.keys(CONSTRAINT_TAGS) as ConstraintTag[]) {
      if (c.includes(CONSTRAINT_TAGS[tag]) && !tags.includes(tag)) tags.push(tag);
    }
  }
  return tags;
}

export function detectHorizon(text: string, fallback: Horizon = 'weeks'): Horizon {
  for (const hint of HORIZON_HINTS) {
    if (hint.match.test(text)) return hint.horizon;
  }
  return fallback;
}

/**
 * Deterministic fallback parser. Used when the LLM step is unavailable and as
 * the baseline the LLM output is normalised against — the model never gets to
 * invent constraints that are not in the text.
 */
export function parseIntentLocally(text: string, horizon?: Horizon): Intent {
  const lines = text
    .split(/\n|(?<=\.)\s+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const constraints: string[] = [];
  const criteria: string[] = [];
  const nonGoals: string[] = [];
  const goalLines: string[] = [];

  for (const line of lines) {
    if (/\b(must not|cannot|can't|no new|without)\b/i.test(line)) constraints.push(line);
    else if (/\b(must|should reach|acceptance|success)\b/i.test(line)) criteria.push(line);
    else if (/\b(out of scope|not doing|won't)\b/i.test(line)) nonGoals.push(line);
    else goalLines.push(line);
  }

  const goal = goalLines[0] ?? DEFAULT_INTENT.goal;
  return {
    goal,
    successCriteria: criteria,
    hardConstraints: constraints,
    softPreferences: [],
    nonGoals,
    horizon: horizon ?? detectHorizon(text),
    source: 'user',
  };
}

export function normaliseIntent(partial: Partial<Intent>, fallbackSource: Intent['source'] = 'user'): Intent {
  return {
    goal: partial.goal?.trim() || DEFAULT_INTENT.goal,
    successCriteria: partial.successCriteria ?? [],
    hardConstraints: partial.hardConstraints ?? [],
    softPreferences: partial.softPreferences ?? [],
    nonGoals: partial.nonGoals ?? [],
    horizon: partial.horizon ?? 'weeks',
    source: partial.source ?? fallbackSource,
  };
}

/**
 * Intent fit is a transparent policy, not a learned judgement. The weights
 * shift with the horizon, which is exactly why the same graph yields a
 * different recommendation for "restore service this week" and "reduce
 * maintenance burden over a year" — and why neither answer is hindsight.
 */
export function intentFit(
  intent: Intent,
  facts: Pick<PathFacts, 'migrationCost' | 'residualRisk' | 'freshness'>,
): IntentFitBreakdown {
  const weights = INTENT_WEIGHTS[intent.horizon];
  const staleness = 1 - facts.freshness;
  const value = clamp01(
    1 -
      (weights.migration * facts.migrationCost +
        weights.residual * facts.residualRisk +
        weights.freshness * staleness),
  );
  return {
    value,
    weights,
    expression: `1 − (${weights.migration}×${facts.migrationCost.toFixed(2)} + ${weights.residual}×${facts.residualRisk.toFixed(2)} + ${weights.freshness}×${staleness.toFixed(2)})`,
  };
}
