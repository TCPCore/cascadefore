import type { Decision } from '../decisions/types';
import { toCommitStatuses, type CommitStatus } from './status';

export interface RunnerRow {
  id: string;
  status: string;
  passed: number;
  failed: number;
  skipped: number;
  detail: string;
}

export interface RunnerReport {
  total: number;
  enforced: number;
  violated: number;
  orphaned: number;
  parseErrors: number;
  testability: number;
  rows: RunnerRow[];
  statuses: CommitStatus[];
}

export function buildRunnerReport(
  decisions: readonly Decision[],
  parseErrors: number,
  options: { repoUrl?: string } = {},
): RunnerReport {
  const counts = { enforced: 0, violated: 0, orphaned: 0 };

  const rows: RunnerRow[] = decisions.map((decision) => {
    if (decision.status === 'enforced') counts.enforced += 1;
    else if (decision.status === 'violated') counts.violated += 1;
    else counts.orphaned += 1;

    const runnable = decision.results.filter((r) => !r.skipped);
    const failedResult = runnable.find((r) => !r.passed);

    return {
      id: decision.id,
      status: decision.status,
      passed: runnable.filter((r) => r.passed).length,
      failed: runnable.filter((r) => !r.passed).length,
      skipped: decision.results.filter((r) => r.skipped).length,
      detail: failedResult?.evidence ?? (runnable[0]?.evidence ?? 'no tests'),
    };
  });

  const testable = counts.enforced + counts.violated;

  return {
    total: decisions.length,
    ...counts,
    parseErrors,
    testability: decisions.length === 0 ? 0 : Math.round((testable / decisions.length) * 1000) / 1000,
    rows,
    statuses: toCommitStatuses(decisions, options),
  };
}

const MARK: Record<string, string> = { enforced: '✓', violated: '✗', orphaned: '—' };

export function formatText(report: RunnerReport): string {
  const lines: string[] = [];
  lines.push(`decisions: ${report.total}   enforced: ${report.enforced}   violated: ${report.violated}   orphaned: ${report.orphaned}`);
  lines.push(`testability: ${Math.round(report.testability * 100)}%   parse errors: ${report.parseErrors}`);
  lines.push('');

  const width = Math.min(64, Math.max(...report.rows.map((r) => r.id.length), 8));
  for (const row of report.rows) {
    const mark = MARK[row.status] ?? '?';
    lines.push(`${mark} ${row.id.padEnd(width)}  ${row.status.padEnd(9)} ${row.detail.slice(0, 90)}`);
  }

  if (report.violated > 0) {
    lines.push('');
    lines.push(`${report.violated} decision(s) violated — the code no longer matches the decision.`);
  }

  return lines.join('\n');
}
