import type { Decision, DecisionStatus, DecisionTest, TestKind, TestResult } from './types';

/**
 * Test execution.
 *
 * Executors are injected per host, because the same decision runs in different
 * places: a Confluence-hosted app can run `graph` tests but cannot read a repo;
 * a repository-hosted app can run `file_match` but cannot see Jira. The status
 * is computed from whatever the host can actually execute, and tests it cannot
 * execute are marked `skipped` rather than silently passing.
 */

export interface ExecutorResult {
  passed: boolean;
  evidence: string;
}

export type Executor = (test: DecisionTest) => Promise<ExecutorResult>;

export type ExecutorRegistry = Partial<Record<TestKind, Executor>>;

function now(): number {
  return Date.now();
}

async function runOne(
  test: DecisionTest,
  executors: ExecutorRegistry,
): Promise<TestResult> {
  const started = now();

  if (test.kind === 'manual') {
    return {
      name: test.name,
      kind: 'manual',
      passed: false,
      skipped: true,
      durationMs: 0,
      evidence: test.note || 'not machine-testable',
    };
  }

  const executor = executors[test.kind];
  if (!executor) {
    return {
      name: test.name,
      kind: test.kind,
      passed: false,
      skipped: true,
      durationMs: now() - started,
      evidence: `no ${test.kind} executor available in this host`,
    };
  }

  try {
    const result = await executor(test);
    return {
      name: test.name,
      kind: test.kind,
      passed: result.passed,
      skipped: false,
      durationMs: now() - started,
      evidence: result.evidence,
      ...('on_fail' in test && test.on_fail ? { onFail: test.on_fail } : {}),
    };
  } catch (error) {
    return {
      name: test.name,
      kind: test.kind,
      passed: false,
      skipped: false,
      durationMs: now() - started,
      evidence: `executor threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Status is derived, never authored.
 *
 *  - no test at all            → orphaned  (a decision nobody can check)
 *  - all runnable tests pass   → enforced
 *  - any runnable test fails   → violated
 *  - nothing runnable here     → orphaned
 *
 * `manual` tests never count. A decision whose only test is a note is a
 * decision the case base cannot learn from, and saying so is the point.
 */
export function statusOf(results: readonly TestResult[]): DecisionStatus {
  const runnable = results.filter((r) => !r.skipped && r.kind !== 'manual');
  if (runnable.length === 0) return 'orphaned';
  return runnable.every((r) => r.passed) ? 'enforced' : 'violated';
}

export async function runDecision(
  decision: Decision,
  executors: ExecutorRegistry,
): Promise<Decision> {
  const results: TestResult[] = [];
  for (const test of decision.tests) {
    results.push(await runOne(test, executors));
  }
  return {
    ...decision,
    results,
    status: statusOf(results),
    lastRunAt: new Date().toISOString(),
  };
}

export async function runAll(
  decisions: readonly Decision[],
  executors: ExecutorRegistry,
): Promise<Decision[]> {
  const out: Decision[] = [];
  for (const decision of decisions) {
    out.push(await runDecision(decision, executors));
  }
  return out;
}

/** Fraction of decisions whose status is machine-derived rather than orphaned. */
export function testabilityRate(decisions: readonly Decision[]): number {
  if (decisions.length === 0) return 0;
  const testable = decisions.filter((d) => d.status === 'enforced' || d.status === 'violated').length;
  return testable / decisions.length;
}
