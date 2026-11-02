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

export const DEFAULT_PATTERN_OPTIONS: PatternOptions = {
  minSupport: 3,
  minRatio: 0.6,
  similarityFloor: 0.5,
};

/** Laplace-smoothed confidence. */
export function confidenceOf(support: number, refutations: number): number {
  return Math.round(((support + 1) / (support + refutations + 2)) * 1000) / 1000;
}

interface Bucket {
  signature: string;
  statuses: Map<string, Set<string>>;
  parts: string[];
}

function signatureParts(a: Decision, b: Decision): string[] {
  const sharedDomain = a.domain.filter((d) => b.domain.includes(d)).map((d) => `domain:${d}`);
  const sharedConstraints = a.constraints
    .filter((c) => b.constraints.includes(c))
    .map((c) => `constraint:${c}`);
  return [...sharedDomain, ...sharedConstraints].sort();
}

function signatureFor(parts: readonly string[]): string {
  return parts.join('|');
}

function comparable(decision: Decision, parts: readonly string[]): boolean {
  const domains = new Set(decision.domain.map((d) => `domain:${d}`));
  const constraints = new Set(decision.constraints.map((c) => `constraint:${c}`));
  return parts.some((part) => domains.has(part) || constraints.has(part));
}

export function extractPatterns(
  decisions: readonly Decision[],
  options: PatternOptions = DEFAULT_PATTERN_OPTIONS,
): Pattern[] {
  const teachable = decisions.filter((d) => d.status === 'enforced' || d.status === 'violated');
  if (teachable.length < options.minSupport) return [];

  const buckets = new Map<string, Bucket>();

  for (let i = 0; i < teachable.length; i += 1) {
    for (let j = i + 1; j < teachable.length; j += 1) {
      const a = teachable[i]!;
      const b = teachable[j]!;
      if (a.status !== b.status) continue;
      const { score } = similarity(contextOf(a), contextOf(b));
      if (score < options.similarityFloor) continue;

      const parts = signatureParts(a, b);
      if (parts.length === 0) continue;

      const key = signatureFor(parts);
      const bucket = buckets.get(key) ?? { signature: key, statuses: new Map(), parts };
      const ids = bucket.statuses.get(a.status) ?? new Set<string>();
      ids.add(a.id);
      ids.add(b.id);
      bucket.statuses.set(a.status, ids);
      buckets.set(key, bucket);
    }
  }

  const patterns: Pattern[] = [];

  for (const bucket of buckets.values()) {
    const population = teachable.filter((d) => comparable(d, bucket.parts));
    for (const [status, ids] of bucket.statuses) {
      const support = ids.size;
      if (support < options.minSupport) continue;
      const refutations = population.filter((d) => d.status !== status).length;
      const ratio = population.length === 0 ? 0 : support / population.length;
      if (ratio < options.minRatio) continue;

      const label = bucket.parts
        .map((p) => p.replace('domain:', '').replace('constraint:', ''))
        .join(', ');

      const patternText =
        status === 'enforced'
          ? `Decisions tagged ${label} have held ${support} of ${support + refutations} times. Reuse the tests that enforced them.`
          : `Decisions tagged ${label} have been violated ${support} of ${support + refutations} times. The constraints may be under-specified — add a test before committing.`;

      patterns.push({
        id: `pat-${bucket.signature.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${status}`,
        patternText,
        domain: bucket.parts.filter((p) => p.startsWith('domain:')).map((p) => p.slice(7)),
        constraints: bucket.parts.filter((p) => p.startsWith('constraint:')).map((p) => p.slice(11)),
        evidenceDecisionIds: [...ids].sort(),
        confidence: confidenceOf(support, refutations),
        confirmations: support,
        refutations,
      });
    }
  }

  return patterns.sort((a, b) => b.confidence - a.confidence || b.confirmations - a.confirmations);
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
