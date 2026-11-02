import type { RawRow } from '../graph/client';

/**
 * Outcome attribution.
 *
 * A violated decision is only actionable if you can see what happened next. The
 * link is a string, not a foreign key: the decisions runner publishes a commit
 * status named `decision/<id>`, Atlassian syncs Bitbucket builds into Teamwork
 * Graph, and this module reads the neighbourhood of that build back out.
 *
 * That is the whole trick — no shared database, no cross-app call, no connector.
 * The join key rides inside a name that both sides already agree on.
 */

export const DECISION_STATUS_PREFIX = 'decision/';

export type AttributionKind =
  | 'build'
  | 'repository'
  | 'work-item'
  | 'pull-request'
  | 'deployment';

export interface AttributionEvent {
  kind: AttributionKind;
  ari: string;
  title: string;
  state?: string;
  /** Present on build events, extracted from `decision/<id>`. */
  decisionId?: string;
}

export function decisionIdFromBuildName(name: string | undefined): string | null {
  if (!name || !name.startsWith(DECISION_STATUS_PREFIX)) return null;
  const id = name.slice(DECISION_STATUS_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

interface NodeValue {
  id?: string;
  data?: Record<string, unknown>;
}

function asNode(value: unknown): NodeValue | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' ? { id: record.id, data: (record.data as Record<string, unknown>) ?? {} } : null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

const KIND_BY_TYPENAME: Record<string, AttributionKind> = {
  ExternalBuild: 'build',
  ExternalRepository: 'repository',
  JiraWorkItem: 'work-item',
  ExternalPullRequest: 'pull-request',
  ExternalDeployment: 'deployment',
};

/**
 * Flattens attribution rows into events, dropping anything without an ARI.
 * The UI never renders an event it cannot cite, same rule as the decision tree.
 */
export function attributeFromRows(rows: readonly RawRow[]): AttributionEvent[] {
  const byAri = new Map<string, AttributionEvent>();

  for (const row of rows) {
    for (const column of ['build', 'repository', 'workItem', 'pullRequest', 'deployment'] as const) {
      const node = asNode(row.columns[column]);
      if (!node?.id) continue;

      const data = node.data ?? {};
      const typename = str(data.__typename);
      const kind = KIND_BY_TYPENAME[typename];
      if (!kind) continue;

      const name = str(data.name, str(data.summary, str(data.title, `${kind} ${node.id}`)));
      const event: AttributionEvent = {
        kind,
        ari: node.id,
        title: name,
        ...(str(data.state) ? { state: str(data.state).toUpperCase() } : {}),
        ...(kind === 'build' && decisionIdFromBuildName(name)
          ? { decisionId: decisionIdFromBuildName(name) as string }
          : {}),
      };

      // Later rows win: the traversal is ordered so the richest row comes last.
      byAri.set(node.id, event);
    }
  }

  return [...byAri.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
}

export interface AttributionSummary {
  decisions: string[];
  builds: number;
  workItems: number;
  pullRequests: number;
  deployments: number;
  failedBuilds: number;
  events: AttributionEvent[];
}

export function summariseAttribution(events: readonly AttributionEvent[]): AttributionSummary {
  const decisions = new Set<string>();
  let builds = 0;
  let workItems = 0;
  let pullRequests = 0;
  let deployments = 0;
  let failedBuilds = 0;

  for (const event of events) {
    if (event.decisionId) decisions.add(event.decisionId);
    switch (event.kind) {
      case 'build':
        builds += 1;
        if (event.state === 'FAILED') failedBuilds += 1;
        break;
      case 'work-item':
        workItems += 1;
        break;
      case 'pull-request':
        pullRequests += 1;
        break;
      case 'deployment':
        deployments += 1;
        break;
      default:
        break;
    }
  }

  return {
    decisions: [...decisions].sort(),
    builds,
    workItems,
    pullRequests,
    deployments,
    failedBuilds,
    events: [...events],
  };
}
