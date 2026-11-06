import type { Decision } from './types';
import { findCounterfactual, type ExtractedAlternative, type PrecedentDecision } from './alternatives';

/**
 * Paths not taken, read from the decision records themselves.
 *
 * Comment prose rarely records what was rejected — the real 2022 thread had no
 * rejection at all. Decision records do: `alternatives:` carries the option and
 * `rejected_because` carries the reason, which is exactly what precedent needs
 * to be compared against.
 *
 * Each alternative is reported with the reason the team gave, and precedent
 * split by the time gate: what the organisation already knew when it decided,
 * versus what it learned afterwards.
 */
export interface CorpusCounterfactual {
  decisionId: string;
  decision: string;
  decidedAt: string;
  name: string;
  rejectedBecause: string | null;
  knownThen: Array<{ decisionId: string; title: string; outcome: string }>;
  learnedLater: Array<{ decisionId: string; title: string; outcome: string }>;
  summary: string;
}

export function toPrecedent(decision: Decision): PrecedentDecision {
  return {
    id: decision.id,
    title: decision.decision,
    decidedAt: decision.decidedAt,
    domain: decision.domain,
    alternatives: decision.alternatives,
  };
}

export function buildCorpusCounterfactuals(decisions: readonly Decision[]): CorpusCounterfactual[] {
  const corpus = decisions.map(toPrecedent);
  const out: CorpusCounterfactual[] = [];

  for (const decision of decisions) {
    for (const alternative of decision.alternatives) {
      // An alternative nobody rejected and nobody recorded a reason for carries
      // no story; it would be noise in the "paths not taken" list.
      if (!alternative.rejected_because) continue;

      const extracted: ExtractedAlternative = {
        name: alternative.name,
        rejected_because: alternative.rejected_because,
        outcome: alternative.outcome,
        evidenceAri: decision.id,
        statedAt: decision.decidedAt,
        knowableAt: decision.decidedAt,
        ownerDecisionId: decision.id,
      };

      const found = findCounterfactual(extracted, corpus, decision.decidedAt);
      const project = (p: { decisionId: string; title: string; outcome: string }) => ({
        decisionId: p.decisionId,
        title: p.title,
        outcome: p.outcome,
      });

      out.push({
        decisionId: decision.id,
        decision: decision.decision,
        decidedAt: decision.decidedAt,
        name: alternative.name,
        rejectedBecause: alternative.rejected_because,
        knownThen: found.knownThen.map(project),
        learnedLater: found.learnedLater.map(project),
        summary: found.summary,
      });
    }
  }

  return out;
}
