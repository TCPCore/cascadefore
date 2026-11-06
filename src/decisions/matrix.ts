import type { Decision, DecisionStatus } from './types';

/**
 * The decision matrix.
 *
 * One aggregate over the index, not a crawl: what areas the organisation has
 * decisions in, and how many of them still hold. This is the "all areas" view,
 * and it runs in milliseconds precisely because the index is ours rather than a
 * graph traversal.
 */
export interface MatrixRow {
  group: string;
  enforced: number;
  violated: number;
  orphaned: number;
  unknown: number;
  total: number;
  oldest: string | null;
  newest: string | null;
}

export interface DecisionMatrix {
  groupBy: 'area' | 'status';
  rows: MatrixRow[];
  totals: Omit<MatrixRow, 'group'> & { areas: number; decisions: number };
  summary: string;
}

const STATUSES: DecisionStatus[] = ['enforced', 'violated', 'orphaned', 'unknown'];

function emptyRow(group: string): MatrixRow {
  return {
    group,
    enforced: 0,
    violated: 0,
    orphaned: 0,
    unknown: 0,
    total: 0,
    oldest: null,
    newest: null,
  };
}

function addToRow(row: MatrixRow, decision: Decision): void {
  const status = STATUSES.includes(decision.status) ? decision.status : 'unknown';
  row[status] += 1;
  row.total += 1;

  const at = decision.decidedAt;
  if (!row.oldest || Date.parse(at) < Date.parse(row.oldest)) row.oldest = at;
  if (!row.newest || Date.parse(at) > Date.parse(row.newest)) row.newest = at;
}

export function buildMatrix(
  decisions: readonly Decision[],
  groupBy: 'area' | 'status' = 'area',
): DecisionMatrix {
  const rows = new Map<string, MatrixRow>();

  for (const decision of decisions) {
    const keys =
      groupBy === 'area'
        ? decision.domain.length > 0
          ? decision.domain
          : ['unclassified']
        : [decision.status];

    for (const key of keys) {
      const row = rows.get(key) ?? emptyRow(key);
      addToRow(row, decision);
      rows.set(key, row);
    }
  }

  const list = [...rows.values()].sort((a, b) => b.total - a.total || a.group.localeCompare(b.group));

  // Rows sum by area and can double count a decision with several domains; the
  // totals must not. They are counted once, from the decisions themselves.
  const statusCount = (status: DecisionStatus) =>
    decisions.filter((decision) => (STATUSES.includes(decision.status) ? decision.status : 'unknown') === status)
      .length;

  const totals = {
    enforced: statusCount('enforced'),
    violated: statusCount('violated'),
    orphaned: statusCount('orphaned'),
    unknown: statusCount('unknown'),
    total: decisions.length,
    oldest: list.reduce<string | null>(
      (oldest, r) => (!oldest || (r.oldest && Date.parse(r.oldest) < Date.parse(oldest)) ? r.oldest : oldest),
      null,
    ),
    newest: list.reduce<string | null>(
      (newest, r) => (!newest || (r.newest && Date.parse(r.newest) > Date.parse(newest)) ? r.newest : newest),
      null,
    ),
    areas: groupBy === 'area' ? list.length : new Set(decisions.flatMap((d) => d.domain)).size,
    decisions: decisions.length,
  };

  const summary =
    decisions.length === 0
      ? 'No decisions in the index yet. Point Cascade at a space or a page to start one.'
      : `${totals.decisions} decision(s) across ${totals.areas} area(s): ${totals.enforced} enforced, ${totals.violated} violated, ${totals.orphaned} orphaned.`;

  return { groupBy, rows: list, totals, summary };
}
