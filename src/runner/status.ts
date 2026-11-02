import type { Decision, DecisionStatus } from '../decisions/types';

/**
 * Commit statuses are the bridge out of CI.
 *
 * Bitbucket commit statuses surface in the Jira development panel and are
 * synced into Teamwork Graph as build objects, which is how a decision's health
 * reaches the case base without either side sharing a database.
 *
 * Constraints: Bitbucket caps `key` at 40 characters, so ids are truncated to
 * fit. The full id is carried in the description and in the URL.
 */

export const STATUS_PREFIX = 'decision/';
const MAX_KEY_LENGTH = 40;

export type CommitState = 'SUCCESSFUL' | 'FAILED' | 'STOPPED';

export interface CommitStatus {
  /** Bitbucket build-status key, ≤ 40 chars. */
  key: string;
  state: CommitState;
  /** Human label; defaults to the decision text. */
  name: string;
  description: string;
  url?: string;
}

const STATE_BY_STATUS: Record<DecisionStatus, CommitState> = {
  enforced: 'SUCCESSFUL',
  violated: 'FAILED',
  // An orphaned decision is not a passing build and not a failure: it is a
  // decision nobody can check. STOPPED is the only honest state available.
  orphaned: 'STOPPED',
  unknown: 'STOPPED',
};

export function statusKeyFor(id: string): string {
  const room = MAX_KEY_LENGTH - STATUS_PREFIX.length;
  return `${STATUS_PREFIX}${id.slice(0, room)}`;
}

export function describe(decision: Decision): string {
  const runnable = decision.results.filter((r) => !r.skipped);
  const passed = runnable.filter((r) => r.passed).length;
  const failed = runnable.filter((r) => !r.passed).length;
  const skipped = decision.results.filter((r) => r.skipped).length;

  if (decision.status === 'orphaned') {
    return `no machine-checkable assertion${skipped ? ` (${skipped} manual)` : ''}`;
  }
  if (decision.status === 'violated') {
    const first = runnable.find((r) => !r.passed);
    return `${failed} of ${runnable.length} failed: ${first?.name ?? 'unknown test'}`.slice(0, 250);
  }
  return `${passed} of ${runnable.length} passed`;
}

export interface StatusOptions {
  /** Base URL for the decision file, appended as `#<id>`. */
  repoUrl?: string;
}

export function toCommitStatuses(
  decisions: readonly Decision[],
  options: StatusOptions = {},
): CommitStatus[] {
  return decisions.map((decision) => ({
    key: statusKeyFor(decision.id),
    state: STATE_BY_STATUS[decision.status],
    name: decision.decision.slice(0, 100),
    description: describe(decision),
    ...(options.repoUrl ? { url: `${options.repoUrl}#${decision.id}` } : {}),
  }));
}
