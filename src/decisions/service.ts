import { loadSeedDecisions, createFixtureExecutors } from './seed';
import { runAll, testabilityRate } from './runner';
import { extractPatterns, growthCurve, type GrowthPoint } from './patterns';
import { findSimilar, type SimilarityResult } from './retrieval';
import type { Decision, DecisionStatus, Pattern, TestResult } from './types';

/**
 * The case base as a single immutable report.
 *
 * Everything the UI shows is computed here once, so the numbers cannot drift
 * between panels: the statuses, the patterns, the growth curve, the orphan rate
 * and the retrieval all come from one pass over one corpus.
 */

export interface DecisionRow {
  id: string;
  decision: string;
  status: DecisionStatus;
  decidedAt: string;
  domain: string[];
  constraints: string[];
  rationale: string;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
}

export interface DecisionReport {
  decisions: DecisionRow[];
  patterns: Pattern[];
  growth: GrowthPoint[];
  counts: Record<DecisionStatus, number>;
  testability: { rate: number; testable: number; total: number };
  generatedAt: string;
}

export function toRow(decision: Decision): DecisionRow {
  const results = decision.results;
  return {
    id: decision.id,
    decision: decision.decision,
    status: decision.status,
    decidedAt: decision.decidedAt,
    domain: decision.domain,
    constraints: decision.constraints,
    rationale: decision.rationale,
    passed: results.filter((r) => !r.skipped && r.passed).length,
    failed: results.filter((r) => !r.skipped && !r.passed).length,
    skipped: results.filter((r) => r.skipped).length,
    results,
  };
}

export async function buildDecisionReport(
  source: readonly Decision[] = loadSeedDecisions(),
  executors = createFixtureExecutors(),
): Promise<DecisionReport> {
  const decisions = await runAll(source, executors);

  const counts: Record<DecisionStatus, number> = {
    enforced: 0,
    violated: 0,
    orphaned: 0,
    unknown: 0,
  };
  for (const decision of decisions) counts[decision.status] += 1;

  const testable = counts.enforced + counts.violated;

  return {
    decisions: decisions.map(toRow),
    patterns: extractPatterns(decisions),
    growth: growthCurve(decisions),
    counts,
    testability: {
      rate: Math.round(testabilityRate(decisions) * 1000) / 1000,
      testable,
      total: decisions.length,
    },
    generatedAt: new Date().toISOString(),
  };
}

export interface SimilarForDecision {
  id: string;
  similar: Array<{
    id: string;
    decision: string;
    status: DecisionStatus;
    score: number;
    because: string[];
  }>;
}

export async function findSimilarFor(id: string): Promise<SimilarForDecision> {
  const ran = await runAll(loadSeedDecisions(), createFixtureExecutors());
  const target = ran.find((d) => d.id === id);
  if (!target) return { id, similar: [] };

  const similar = findSimilar(target, ran, 5).map((entry: { decision: Decision; score: number; because: string[] }) => ({
    id: entry.decision.id,
    decision: entry.decision.decision,
    status: entry.decision.status,
    score: entry.score,
    because: entry.because,
  }));

  return { id, similar };
}

export type { SimilarityResult, GrowthPoint, Pattern };
