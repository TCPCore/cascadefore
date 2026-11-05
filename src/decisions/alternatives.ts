import type { Alternative } from './types';
import type { Ari, Iso } from '../shared/types';

/**
 * Rejected alternatives, with reasons.
 *
 * A branch that says only "we did not do this" is a dead end — it carries no
 * story, so nothing downstream can use it. What makes the counterfactual layer
 * possible is the *reason*, because that is the thing precedent can be matched
 * against: "we rejected MongoDB because ACID" can be compared with two other
 * teams who took MongoDB and found out.
 *
 * Extraction is deliberately conservative: a rejection without a stated reason
 * is still recorded, with `rejected_because: null`, and reported as such rather
 * than given an invented justification.
 */

export interface ProseComment {
  ari: Ari;
  body: string;
  createdAt: Iso;
  authorAri?: Ari;
}

export interface ExtractedAlternative extends Omit<Alternative, 'rejected_because'> {
  /** null means "rejected, but no reason was stated" — never invented. */
  rejected_because: string | null;
  /** Where the rejection was stated. */
  evidenceAri: Ari;
  statedAt: Iso;
  /** The decision time this was knowable at — always ≤ statedAt. */
  knowableAt: Iso;
  /** The decision that rejected it. A decision is never its own precedent. */
  ownerDecisionId?: string;
}

const REJECTION_PATTERNS: Array<{
  pattern: RegExp;
  name: (m: RegExpMatchArray) => string;
  reason: (m: RegExpMatchArray) => string | null;
}> = [
  {
    // "not MongoDB because weak ACID"
    pattern: /\bnot\s+([\w][\w\s./-]{1,48}?)\s+(?:because|since|as)\s+([^.;]{3,160})/i,
    name: (m) => m[1] ?? '',
    reason: (m) => m[2] ?? null,
  },
  {
    // "we rejected MongoDB — weak ACID"
    pattern: /\b(?:we\s+)?(?:rejected|ruled\s+out|avoided|passed\s+on)\s+([\w][\w\s./-]{1,48})(?:\s*(?:—|-|:)\s*([^.;]{3,160}))?/i,
    name: (m) => m[1] ?? '',
    reason: (m) => m[2] ?? null,
  },
  {
    // "didn't go with MongoDB"
    pattern: /\b(?:didn'?t|did\s+not)\s+go\s+with\s+([\w][\w\s./-]{1,48}?)(?:\s+(?:because|since)\s+([^.;]{3,160}))?(?=[.;]|$)/i,
    name: (m) => m[1] ?? '',
    reason: (m) => m[2] ?? null,
  },
  {
    // "we considered MongoDB but weak ACID"
    pattern: /\bconsidered\s+([\w][\w\s./-]{1,48}?)\s+but\s+([^.;]{3,160})/i,
    name: (m) => m[1] ?? '',
    reason: (m) => m[2] ?? null,
  },
  {
    // "went with Postgres over MongoDB due to ACID"
    pattern: /\bwent\s+with\s+[\w][\w\s./-]{1,40}?\s+over\s+([\w][\w\s./-]{1,40}?)\s+(?:because|due\s+to|for)\s+([^.;]{3,160})/i,
    name: (m) => m[1] ?? '',
    reason: (m) => m[2] ?? null,
  },
];

function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/^[\s,:;-]+|[\s,;:-]+$/g, '').trim();
}

/** Extracts every rejected alternative stated in a set of comments. */
export function extractRejectedAlternatives(
  comments: readonly ProseComment[],
  decidedAt: Iso,
): ExtractedAlternative[] {
  const out: ExtractedAlternative[] = [];

  for (const comment of comments) {
    for (const rule of REJECTION_PATTERNS) {
      const match = comment.body.match(rule.pattern);
      if (!match) continue;

      const name = tidy(rule.name(match));
      if (name.length < 2) continue;

      const reason = rule.reason(match);
      out.push({
        name,
        rejected_because: reason ? tidy(reason) : null,
        outcome: 'never_tried',
        evidenceAri: comment.ari,
        statedAt: comment.createdAt,
        // The gate: what was knowable when the decision was made, not when the
        // comment happened to be written.
        knowableAt:
          Date.parse(comment.createdAt) <= Date.parse(decidedAt) ? comment.createdAt : decidedAt,
      });
    }
  }

  // Same alternative stated twice is one alternative; keep the one with a reason.
  const byName = new Map<string, ExtractedAlternative>();
  for (const alternative of out) {
    const key = alternative.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || (!existing.rejected_because && alternative.rejected_because)) {
      byName.set(key, alternative);
    }
  }

  return [...byName.values()].sort((a, b) => Date.parse(a.statedAt) - Date.parse(b.statedAt));
}

/* ------------------------------------------------------------------ */
/* Precedent                                                           */
/* ------------------------------------------------------------------ */

export type PrecedentOutcome = 'held' | 'reverted' | 'unknown';

export interface PrecedentDecision {
  id: string;
  title: string;
  decidedAt: Iso;
  domain: string[];
  /** Alternatives this decision's record already carries, with outcomes. */
  alternatives: Alternative[];
}

export interface Precedent {
  decisionId: string;
  title: string;
  decidedAt: Iso;
  outcome: PrecedentOutcome;
  /** true when this precedent existed at the target's decision time. */
  knowableAtDecisionTime: boolean;
  because: string[];
}

export interface Counterfactual {
  alternative: ExtractedAlternative;
  /** Precedents the organisation already had at decision time. */
  knownThen: Precedent[];
  /** Precedents that only became visible afterwards. */
  learnedLater: Precedent[];
  summary: string;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'we', 'our',
  'it', 'that', 'this', 'is', 'are', 'was', 'were', 'be', 'as', 'at', 'by', 'from',
  'not', 'no', 'use', 'used', 'using', 'would', 'could', 'should',
]);

function terms(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
    ),
  );
}

function sharedTerms(a: string, b: string): string[] {
  const setB = new Set(terms(b));
  return terms(a).filter((t) => setB.has(t));
}

/**
 * Finds decisions that took a similar alternative, split by the time gate.
 *
 * The split is the point. `knownThen` is what the organisation could have
 * learned from at the moment it decided; `learnedLater` is what it found out
 * afterwards. Presenting them in one list is hindsight; presenting them apart is
 * a comparison of equal-information decisions.
 */
export function findCounterfactual(
  alternative: ExtractedAlternative,
  corpus: readonly PrecedentDecision[],
  decisionTime: Iso,
): Counterfactual {
  const precedents: Precedent[] = [];

  for (const candidate of corpus) {
    // A decision cannot be precedent for itself, and "considered but nobody
    // recorded an outcome" is not a trial. Both mistakes inflate the evidence.
    if (alternative.ownerDecisionId && candidate.id === alternative.ownerDecisionId) continue;

    const tried = (outcome: string | undefined): boolean =>
      outcome === 'tried_ok' || outcome === 'tried_bad';

    const taken = candidate.alternatives.find(
      (alt) => sharedTerms(alternative.name, alt.name).length > 0 && tried(alt.outcome),
    );

    const because = sharedTerms(alternative.name, `${candidate.title} ${candidate.domain.join(' ')}`);
    if (!taken && because.length === 0) continue;
    const triedOutcome = taken?.outcome;

    const outcome: PrecedentOutcome =
      triedOutcome === 'tried_ok'
        ? 'held'
        : triedOutcome === 'tried_bad'
          ? 'reverted'
          : 'unknown';

    precedents.push({
      decisionId: candidate.id,
      title: candidate.title,
      decidedAt: candidate.decidedAt,
      outcome,
      knowableAtDecisionTime: Date.parse(candidate.decidedAt) <= Date.parse(decisionTime),
      because:
        taken && triedOutcome
          ? [`tried ${taken.name}`, `outcome ${triedOutcome.replace('tried_', '')}`]
          : because.map(
              (t) => `shared term "${t}"`,
            ),
    });
  }

  const knownThen = precedents.filter((p) => p.knowableAtDecisionTime);
  const learnedLater = precedents.filter((p) => !p.knowableAtDecisionTime);

  const summary =
    knownThen.length === 0
      ? `At decision time this organisation had no precedent for "${alternative.name}". The choice was made on documentation, not experience.`
      : `At decision time the organisation already had ${knownThen.length} precedent(s) for "${alternative.name}".`;

  return { alternative, knownThen, learnedLater, summary };
}
