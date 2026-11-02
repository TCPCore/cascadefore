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

export interface CaseBase {
  models: Decision[];
  report: DecisionReport;
}

/**
 * Runs the corpus and derives everything from one pass. Returning the models
 * alongside the report lets the caller persist the ledger without re-running.
 */
export async function computeCaseBase(
  source: readonly Decision[] = loadSeedDecisions(),
  executors = createFixtureExecutors(),
): Promise<CaseBase> {
  const models = await runAll(source, executors);

  const counts: Record<DecisionStatus, number> = {
    enforced: 0,
    violated: 0,
    orphaned: 0,
    unknown: 0,
  };
  for (const decision of models) counts[decision.status] += 1;

  const testable = counts.enforced + counts.violated;

  const report: DecisionReport = {
    decisions: models.map(toRow),
    patterns: extractPatterns(models),
    growth: growthCurve(models),
    counts,
    testability: {
      rate: Math.round(testabilityRate(models) * 1000) / 1000,
      testable,
      total: models.length,
    },
    generatedAt: new Date().toISOString(),
  };

  return { models, report };
}

export async function buildDecisionReport(
  source: readonly Decision[] = loadSeedDecisions(),
  executors = createFixtureExecutors(),
): Promise<DecisionReport> {
  const { report } = await computeCaseBase(source, executors);
  return report;
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

export async function findSimilarFor(
  id: string,
  source: readonly Decision[] = loadSeedDecisions(),
  executors = createFixtureExecutors(),
): Promise<SimilarForDecision> {
  const ran = await runAll(source, executors);
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
