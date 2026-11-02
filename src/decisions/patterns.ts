import type { Decision, Pattern } from './types';
import { contextOf, similarity } from './retrieval';

/**
 * Pattern extraction.
 *
 * A pattern is a claim of the form "decisions that share X tend to hold" and it
 * is only admitted when it is supported by several cases *and* that support is
 * a large share of the comparable population. Without the ratio guard, three
 * coincidences in a corpus of fifty would produce a confident rule.
 *
 * Confidence uses Laplace smoothing:
 *
 *     (support + 1) / (support + refutations + 2)
 *
 * Three clean cases give 0.80, not 1.00. With three data points, certainty is a
 * lie — and the demo's whole claim is that this thing accumulates evidence
 * rather than asserting truth.
 */

export interface PatternOptions {
  minSupport: number;
  minRatio: number;
  similarityFloor: number;
}

/**
 * The floor is deliberately low because bucketing is structural: a bucket is a
 * single shared domain or constraint, so two decisions that share nothing
 * produce no bucket at all. The floor only filters pairs whose *only* overlap
 * is incidental term noise.
 */
export const DEFAULT_PATTERN_OPTIONS: PatternOptions = {
  minSupport: 3,
  minRatio: 0.6,
  similarityFloor: 0.25,
};

/** Laplace-smoothed confidence. */
export function confidenceOf(support: number, refutations: number): number {
  return Math.round(((support + 1) / (support + refutations + 2)) * 1000) / 1000;
}

interface Bucket {
  part: string;
  ids: Map<string, Set<string>>;
}

function partsOf(decision: Decision): string[] {
  return [
    ...decision.domain.map((d) => `domain:${d}`),
    ...decision.constraints.map((c) => `constraint:${c}`),
  ];
}

function hasPart(decision: Decision, part: string): boolean {
  return partsOf(decision).includes(part);
}

function labelOf(part: string): string {
  return part.replace('domain:', '').replace('constraint:', '');
}

/**
 * One pattern per shared *part*, not per shared *combination*.
 *
 * Bucketing on the exact shared set fragments support: two decisions sharing a
 * domain and a constraint land in a different bucket from two sharing only the
 * domain, so a corpus of five splits into slivers and nothing ever reaches the
 * support threshold. Bucketing per part is both simpler and the thing the claim
 * actually says: "decisions tagged X tend to hold".
 */
export function extractPatterns(
  decisions: readonly Decision[],
  options: PatternOptions = DEFAULT_PATTERN_OPTIONS,
): Pattern[] {
  const teachable = decisions.filter((d) => d.status === 'enforced' || d.status === 'violated');
  if (teachable.length < options.minSupport) return [];

  const buckets = new Map<string, Bucket>();
  const attach = (part: string, decision: Decision): void => {
    const bucket = buckets.get(part) ?? { part, ids: new Map() };
    const ids = bucket.ids.get(decision.status) ?? new Set<string>();
    ids.add(decision.id);
    bucket.ids.set(decision.status, ids);
    buckets.set(part, bucket);
  };

  for (let i = 0; i < teachable.length; i += 1) {
    for (let j = i + 1; j < teachable.length; j += 1) {
      const a = teachable[i]!;
      const b = teachable[j]!;
      if (a.status !== b.status) continue;
      const { score } = similarity(contextOf(a), contextOf(b));
      if (score < options.similarityFloor) continue;

      for (const part of partsOf(a).filter((p) => hasPart(b, p))) {
        attach(part, a);
        attach(part, b);
      }
    }
  }

  const patterns: Pattern[] = [];

  for (const bucket of buckets.values()) {
    const population = teachable.filter((d) => hasPart(d, bucket.part));
    for (const [status, ids] of bucket.ids) {
      const support = ids.size;
      if (support < options.minSupport) continue;

      const refutations = population.filter((d) => d.status !== status).length;
      const ratio = population.length === 0 ? 0 : support / population.length;
      if (ratio < options.minRatio) continue;

      const label = labelOf(bucket.part);
      const total = support + refutations;

      const patternText =
        status === 'enforced'
          ? `Decisions tagged ${label} have held ${support} of ${total} times. Reuse the tests that enforced them.`
          : `Decisions tagged ${label} have been violated ${support} of ${total} times. The constraints may be under-specified — add a test before committing.`;

      patterns.push({
        id: `pat-${bucket.part.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${status}`,
        patternText,
        domain: bucket.part.startsWith('domain:') ? [label] : [],
        constraints: bucket.part.startsWith('constraint:') ? [label] : [],
        evidenceDecisionIds: [...ids].sort(),
        confidence: confidenceOf(support, refutations),
        confirmations: support,
        refutations,
      });
    }
  }

  return patterns.sort(
    (a, b) => b.confidence - a.confidence || b.confirmations - a.confirmations || a.id.localeCompare(b.id),
  );
}

export interface GrowthPoint {
  n: number;
  patternCount: number;
  top: { id: string; confidence: number; confirmations: number; refutations: number } | null;
}

/**
 * The growth curve: patterns recomputed over the corpus as it existed after
 * each decision was added, in decision order. This is what "the case base
 * accumulates evidence" looks like as a number.
 *
 * An orphaned decision is excluded from the teachable set, so adding one leaves
 * the curve flat — which is the honest result: the case base cannot learn from
 * a decision nobody can check.
 */
export function growthCurve(
  decisions: readonly Decision[],
  options: PatternOptions = DEFAULT_PATTERN_OPTIONS,
): GrowthPoint[] {
  const ordered = [...decisions].sort((a, b) => Date.parse(a.decidedAt) - Date.parse(b.decidedAt));
  const points: GrowthPoint[] = [];

  for (let n = 1; n <= ordered.length; n += 1) {
    const patterns = extractPatterns(ordered.slice(0, n), options);
    const top = patterns[0];
    points.push({
      n,
      patternCount: patterns.length,
      top: top
        ? {
            id: top.id,
            confidence: top.confidence,
            confirmations: top.confirmations,
            refutations: top.refutations,
          }
        : null,
    });
  }

  return points;
}
