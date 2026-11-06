import { findCounterfactual, type ExtractedAlternative } from '../decisions/alternatives';
import { toPrecedent } from '../decisions/counterfactuals';
import { loadSeedDecisions } from '../decisions/seed';

/**
 * The counterfactual primitive.
 *
 * "What happened when other teams took the path we rejected?" — answered with
 * the time gate applied, because the honest version of that question is not
 * "what do we know now" but "what was knowable when the decision was made".
 *
 * Each precedent is returned with `knowableAtOriginalDecision`. The agent cannot
 * infer that boolean, so the primitive states it: precedent after the decision
 * date is knowledge the team could not have had.
 */
export interface PrecedentRow {
  decisionId: string;
  title: string;
  decidedAt: string;
  outcome: string;
  knowableAtOriginalDecision: boolean;
  because: string[];
}

export interface PrecedentResult {
  alternativeText: string;
  asOf: string;
  knownThen: PrecedentRow[];
  learnedLater: PrecedentRow[];
  summary: string;
}

export interface PrecedentRequest {
  alternativeText?: string;
  asOf?: string;
  area?: string;
}

export function findPrecedentFor(request: PrecedentRequest): PrecedentResult {
  const alternativeText = (request.alternativeText ?? '').trim();
  const asOf = request.asOf && Number.isFinite(Date.parse(request.asOf))
    ? request.asOf
    : new Date().toISOString();

  if (!alternativeText) {
    return {
      alternativeText,
      asOf,
      knownThen: [],
      learnedLater: [],
      summary: 'No alternative named. Ask which option was rejected, then ask again with that option.',
    };
  }

  const corpus = loadSeedDecisions()
    .filter((decision) => !request.area || decision.domain.includes(request.area))
    .map(toPrecedent);

  const alternative: ExtractedAlternative = {
    name: alternativeText,
    rejected_because: null,
    outcome: 'never_tried',
    evidenceAri: 'query',
    statedAt: asOf,
    knowableAt: asOf,
  };

  const found = findCounterfactual(alternative, corpus, asOf);
  const project = (row: (typeof found.knownThen)[number]): PrecedentRow => ({
    decisionId: row.decisionId,
    title: row.title,
    decidedAt: row.decidedAt,
    outcome: row.outcome,
    knowableAtOriginalDecision: row.knowableAtDecisionTime,
    because: row.because,
  });

  return {
    alternativeText,
    asOf,
    knownThen: found.knownThen.map(project),
    learnedLater: found.learnedLater.map(project),
    summary: found.summary,
  };
}

export async function findPrecedentAction(event: unknown): Promise<Record<string, unknown>> {
  const record =
    event && typeof event === 'object'
      ? (((event as Record<string, unknown>).input ??
          (event as Record<string, unknown>).payload ??
          event) as Record<string, unknown>)
      : {};

  return findPrecedentFor({
    alternativeText: typeof record.alternativeText === 'string' ? record.alternativeText : undefined,
    asOf: typeof record.asOf === 'string' ? record.asOf : undefined,
    area: typeof record.area === 'string' ? record.area : undefined,
  }) as unknown as Record<string, unknown>;
}
