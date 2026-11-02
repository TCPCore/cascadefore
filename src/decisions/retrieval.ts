import type { Decision, DecisionContext, SimilarDecision } from './types';

/**
 * Retrieval by shared structure, not by embedding.
 *
 * A decision is retrieved because it shares a domain, a constraint, or a
 * technical term — and the match says which. That makes every retrieval
 * explainable in one sentence, which a cosine similarity of 0.83 is not.
 *
 * The trade is real and worth stating: this finds cases that share the labels
 * you already knew to look for. It does not find "structurally similar but
 * conceptually unrelated" cases. For a case base of executable decisions, that
 * is the right trade — precision over surprise.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'is', 'are', 'we',
  'our', 'it', 'that', 'this', 'be', 'as', 'at', 'by', 'from', 'into', 'not', 'no', 'so',
  'use', 'using', 'used', 'will', 'can', 'should', 'must', 'have', 'has', 'was', 'were',
]);

export function termsOf(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9#_-]+/g, ' ')
        .split(' ')
        .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
    ),
  );
}

export function contextOf(decision: Decision): DecisionContext {
  const text = `${decision.decision} ${decision.rationale}`;
  const decisionType: DecisionContext['decisionType'] = /defer|postpone|revisit later/i.test(text)
    ? 'deferral'
    : /revert|reverse|undo|roll back/i.test(text)
      ? 'reversal'
      : decision.constraints.length > 0 && decision.alternatives.length === 0
        ? 'constraint'
        : 'choice';

  return {
    domain: [...decision.domain].sort(),
    constraints: [...decision.constraints].sort(),
    terms: termsOf(text),
    decisionType,
  };
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const value of setA) if (setB.has(value)) shared += 1;
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}

function overlap(a: readonly string[], b: readonly string[]): string[] {
  const setB = new Set(b);
  return a.filter((value) => setB.has(value));
}

export interface SimilarityResult {
  score: number;
  because: string[];
}

export function similarity(a: DecisionContext, b: DecisionContext): SimilarityResult {
  const sharedDomain = overlap(a.domain, b.domain);
  const sharedConstraints = overlap(a.constraints, b.constraints);
  const sharedTerms = overlap(a.terms, b.terms).slice(0, 6);

  const score =
    0.5 * jaccard(a.domain, b.domain) +
    0.35 * jaccard(a.constraints, b.constraints) +
    0.15 * jaccard(a.terms, b.terms);

  const because: string[] = [];
  for (const d of sharedDomain) because.push(`shared domain "${d}"`);
  for (const c of sharedConstraints) because.push(`shared constraint "${c}"`);
  if (sharedTerms.length > 0) because.push(`shared terms: ${sharedTerms.join(', ')}`);
  if (because.length === 0) because.push('no shared structure');

  return { score: Math.round(score * 10000) / 10000, because };
}

export function findSimilar(
  target: Decision,
  candidates: readonly Decision[],
  k = 5,
): SimilarDecision[] {
  const ctx = contextOf(target);
  return candidates
    .filter((candidate) => candidate.id !== target.id)
    .map((candidate) => {
      const { score, because } = similarity(ctx, contextOf(candidate));
      return { decision: candidate, score, because };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function findByContext(
  context: DecisionContext,
  candidates: readonly Decision[],
  k = 5,
): SimilarDecision[] {
  return candidates
    .map((candidate) => {
      const { score, because } = similarity(context, contextOf(candidate));
      return { decision: candidate, score, because };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
