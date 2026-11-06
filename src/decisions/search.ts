import type { Decision, DecisionStatus } from './types';
import { computeCaseBase } from './service';

/**
 * The front door.
 *
 * Without this an agent can only act on an id somebody already handed it, which
 * is not how the question arrives: people ask "why does the billing service use
 * Postgres", not "get decision 0012". Search is deliberately keyword-driven and
 * explainable — every hit says why it matched, because a silent ranking is a
 * claim the model cannot check.
 */

export interface SearchHit {
  id: string;
  decision: string;
  status: DecisionStatus;
  decidedAt: string;
  domain: string[];
  constraints: string[];
  rationale: string;
  alternatives: Array<{ name: string; rejectedBecause: string | null; outcome: string }>;
  /** Why this matched, so the agent can cite it and the user can judge it. */
  because: string[];
  score: number;
}

export interface SearchRequest {
  text?: string;
  area?: string;
  status?: string;
  limit?: number;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  summary: string;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'we', 'our',
  'is', 'are', 'was', 'were', 'be', 'as', 'at', 'by', 'from', 'why', 'does', 'do',
  'did', 'how', 'what', 'this', 'that', 'it', 'use', 'uses', 'using', 'decision',
]);

function terms(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
    ),
  );
}

function scoreDecision(decision: Decision, query: string[], area?: string): { score: number; because: string[] } {
  const because: string[] = [];
  let score = 0;

  const title = decision.decision.toLowerCase();
  const rationale = decision.rationale.toLowerCase();
  const constraints = decision.constraints.join(' ').toLowerCase();
  const domains = decision.domain.join(' ').toLowerCase();
  const alternativeText = decision.alternatives
    .map((alt) => `${alt.name} ${alt.rejected_because ?? ''}`)
    .join(' ')
    .toLowerCase();

  for (const term of query) {
    if (title.includes(term)) {
      score += 3;
      because.push(`title contains "${term}"`);
    }
    if (domains.includes(term)) {
      score += 2;
      because.push(`area contains "${term}"`);
    }
    if (constraints.includes(term)) {
      score += 2;
      because.push(`constraint contains "${term}"`);
    }
    if (alternativeText.includes(term)) {
      score += 2;
      because.push(`rejected alternative mentions "${term}"`);
    }
    if (rationale.includes(term)) {
      score += 1;
      because.push(`rationale mentions "${term}"`);
    }
  }

  if (area && decision.domain.includes(area)) {
    score += 3;
    because.push(`in area "${area}"`);
  }

  return { score, because };
}

export async function searchDecisions(
  request: SearchRequest,
  source?: readonly Decision[],
): Promise<SearchResult> {
  const decisions = source ?? (await computeCaseBase()).models;
  const query = terms(request.text ?? '');
  const status = request.status as DecisionStatus | undefined;
  const limit = Math.max(1, Math.min(25, request.limit ?? 10));

  const scored = decisions
    .filter((decision) => !status || decision.status === status)
    .map((decision) => {
      const { score, because } = scoreDecision(decision, query, request.area);
      return { decision, score, because };
    })
    // With no query, everything matches equally: return the most recent instead
    // of pretending a ranking exists.
    .filter((entry) => (query.length === 0 && !request.area) || entry.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.decision.decidedAt) - Date.parse(a.decision.decidedAt))
    .slice(0, limit);

  const hits: SearchHit[] = scored.map(({ decision, score, because }) => ({
    id: decision.id,
    decision: decision.decision,
    status: decision.status,
    decidedAt: decision.decidedAt,
    domain: decision.domain,
    constraints: decision.constraints,
    rationale: decision.rationale.trim(),
    alternatives: decision.alternatives.map((alt) => ({
      name: alt.name,
      rejectedBecause: alt.rejected_because ?? null,
      outcome: alt.outcome ?? 'unknown',
    })),
    because,
    score,
  }));

  const summary =
    hits.length === 0
      ? `No decision matches "${request.text ?? ''}". The index has ${decisions.length} decisions; try an area, a constraint, or a technology name.`
      : `${hits.length} of ${decisions.length} decisions match. Top hit: ${hits[0]!.decision} (${hits[0]!.status}).`;

  return { query: request.text ?? '', hits, summary };
}

/**
 * "Why is this like this?"
 *
 * The onboarding question, answered by walking the index backwards from a
 * technology, a constraint, an issue key or a page id. It returns the decisions
 * and the rationale, and it does not speculate about intent that was never
 * recorded.
 */
export interface WhyResult {
  question: string;
  decisions: Array<{
    id: string;
    decision: string;
    status: DecisionStatus;
    decidedAt: string;
    rationale: string;
    alternatives: Array<{ name: string; rejectedBecause: string | null; outcome: string }>;
    because: string[];
  }>;
  summary: string;
}

export async function whyIsThisLikeThis(input: {
  subject: string;
  source?: readonly Decision[];
}): Promise<WhyResult> {
  const subject = input.subject.trim();
  const result = await searchDecisions({ text: subject, limit: 5 }, input.source);

  const decisions = result.hits.map((hit) => ({
    id: hit.id,
    decision: hit.decision,
    status: hit.status,
    decidedAt: hit.decidedAt,
    rationale: hit.rationale,
    alternatives: hit.alternatives,
    because: hit.because,
  }));

  const summary =
    decisions.length === 0
      ? `Nothing in the index explains "${subject}". That is a finding: the decision either was never recorded, or used vocabulary the index does not contain.`
      : `${decisions.length} decision(s) shape "${subject}". The earliest is ${decisions[decisions.length - 1]!.decision} (${decisions[decisions.length - 1]!.decidedAt.slice(0, 10)}).`;

  return { question: subject, decisions, summary };
}
