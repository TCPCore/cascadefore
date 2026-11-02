import type { ScopeProbeResult, Iso } from '../shared/types';
import { SCOPE_FOR_OBJECT_TYPE } from './queries';
import type { RawArtifact } from './extract';
import type { GraphCaller, RawRow } from './client';
import { buildRawCypherDocument, runPersistedQuery } from './client';
import type { GraphCollection, GraphSource } from '../pipeline/run';

export interface QueryKeys {
  spine: string;
  branches: string;
  /**
   * No verified outcomes traversal exists: the Jira→build edge does not plan
   * against this schema. Kept optional so an install can add one later without
   * a code change; when absent, outcomes simply come from elsewhere.
   */
  outcomes?: string;
}

interface NodeValue {
  id?: string;
  data?: Record<string, unknown>;
}

function asNode(value: unknown): NodeValue | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id === 'string') return { id: v.id, data: (v.data as Record<string, unknown>) ?? {} };
  return null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function iso(value: unknown, fallback: Iso): Iso {
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback;
}

function artifactFrom(value: unknown, fallback: Iso): RawArtifact | null {
  const node = asNode(value);
  if (!node?.id) return null;
  const data = node.data ?? {};
  const typename = str(data.__typename);

  switch (typename) {
    case 'ConfluencePage':
      return {
        ari: node.id,
        type: 'confluence-page',
        title: str(data.title, 'Untitled page'),
        createdAt: iso(data.createdAt, fallback),
        ...(str(data.webUrl) ? { webUrl: str(data.webUrl) } : {}),
      };
    case 'ConfluenceComment':
      return {
        ari: node.id,
        type: 'confluence-comment',
        title: str(data.body, 'Comment').slice(0, 200),
        createdAt: iso(data.createdAt, fallback),
        bodyText: str(data.body),
      };
    case 'JiraWorkItem':
      return {
        ari: node.id,
        type: 'jira-work-item',
        title: str(data.summary, str(data.key, 'Work item')),
        createdAt: iso(data.createdAt, fallback),
      };
    case 'ExternalBuild':
    case 'ExternalCommit': {
      const state = str(data.state, str(data.status)).toUpperCase();
      const passed = state === 'SUCCESSFUL' || state === 'PASSED';
      const failed = state === 'FAILED';
      return {
        ari: node.id,
        type: typename === 'ExternalBuild' ? 'external-build' : 'external-pull-request',
        title: str(data.name, str(data.message, `${typename} ${node.id}`)),
        createdAt: iso(data.createdAt, fallback),
        implementationProof: passed,
        outcome: passed ? 'passed' : failed ? 'failed' : 'unknown',
      };
    }
    default:
      return null;
  }
}

/**
 * Maps one page of `spine` rows into artefacts. A row can carry a page, a
 * comment and an author at once; each is extracted independently so the
 * traversal does not lose evidence when a row is partially populated.
 */
/**
 * The graph cannot be filtered by issue key — `key` and `summary` are hydrated
 * fields, not Cypher properties — so the query returns a bounded window and the
 * target row is chosen here by its hydrated `key`. Correctness over efficiency,
 * and only safe because the window is capped.
 */
export function selectWorkItemRows(
  rows: readonly RawRow[],
  workItemKey: string,
): readonly RawRow[] {
  const matches = rows.filter((row) => {
    const node = asNode(row.columns.workItem);
    const key = node?.data ? str(node.data.key) : '';
    return key === workItemKey;
  });
  return matches.length > 0 ? matches : rows;
}

export function mapSpineRows(rows: readonly RawRow[], fallback: Iso): RawArtifact[] {
  const out: RawArtifact[] = [];
  for (const row of rows) {
    // Column names must match the RETURN clause in SPINE_QUERY.
    for (const key of ['workItem', 'workItemComment', 'jiraSpace', 'linkedWorkItem', 'remoteLink', 'build']) {
      const value = row.columns[key];
      if (!value) continue;
      const list = (value as { nodes?: unknown[] }).nodes;
      if (Array.isArray(list)) {
        for (const item of list) {
          const artifact = artifactFrom(item, fallback);
          if (artifact) out.push(artifact);
        }
      } else {
        const artifact = artifactFrom(value, fallback);
        if (artifact) out.push(artifact);
      }
    }
  }
  return out;
}

export function mapBranchRows(rows: readonly RawRow[], fallback: Iso): RawArtifact[] {
  const out: RawArtifact[] = [];
  for (const row of rows) {
    // Column names must match the RETURN clause in BRANCH_QUERY.
    const page = artifactFrom(row.columns.page, fallback);
    if (page) out.push(page);

    const comment = artifactFrom(row.columns.comment, fallback);
    if (comment) {
      // The traversal returns individual comments, not reply counts.
      comment.replyCount = 1;
      out.push(comment);
    }
  }
  return out;
}

export function mapOutcomeRows(rows: readonly RawRow[], fallback: Iso): RawArtifact[] {
  const out: RawArtifact[] = [];
  for (const row of rows) {
    const build = asNode(row.columns.build);
    if (build?.id) {
      const data = build.data ?? {};
      const state = str(data.state).toUpperCase();
      out.push({
        ari: build.id,
        type: 'external-build',
        title: str(data.name, `Build ${build.id}`),
        createdAt: iso(data.createdAt, fallback),
        implementationProof: state === 'SUCCESSFUL' || state === 'PASSED',
        outcome: state === 'FAILED' ? 'failed' : state === 'SUCCESSFUL' ? 'passed' : 'unknown',
      });
    }
    const deployment = asNode(row.columns.deployment);
    if (deployment?.id) {
      const data = deployment.data ?? {};
      const state = str(data.state).toUpperCase();
      out.push({
        ari: deployment.id,
        type: 'external-deployment',
        title: `Deployment ${deployment.id}`,
        createdAt: iso(data.createdAt, fallback),
        implementationProof: state === 'COMPLETED',
        outcome: state === 'FAILED' ? 'failed' : state === 'COMPLETED' ? 'passed' : 'unknown',
      });
    }
  }
  return out;
}

/**
 * Scope probe. A missing Teamwork Graph scope returns an empty result rather
 * than an error, so "no data" and "no permission" are indistinguishable. This
 * asks the graph for one row of each type and reports which types came back.
 */
export async function probeScopes(
  caller: GraphCaller,
  types: readonly string[],
  workItemKey: string,
): Promise<ScopeProbeResult[]> {
  const results: ScopeProbeResult[] = [];
  for (const objectType of types) {
    const scope = SCOPE_FOR_OBJECT_TYPE[objectType];
    if (!scope) continue;
    try {
      const response = await caller(buildRawCypherDocument(), {
        cypherQuery: `MATCH (n:${objectType}) RETURN n LIMIT 1`,
        params: { workItemKey },
      });
      const yielded = Boolean(response.data) && !response.errors;
      results.push({ objectType, scope, yielded });
    } catch {
      results.push({ objectType, scope, yielded: false });
    }
  }
  return results;
}

export function createGraphSource(
  caller: GraphCaller,
  keys: QueryKeys,
  options: { now: () => Iso; probeTypes?: string[] } = { now: () => new Date().toISOString() },
): GraphSource {
  return {
    async collect(workItemKey: string): Promise<GraphCollection> {
      const started = Date.now();
      const fallback = options.now();

      const spine = await runPersistedQuery(caller, keys.spine, { workItemKey, limit: 25 }, (rows) =>
        mapSpineRows(rows, fallback),
      );
      if (spine.errorCode) {
        return {
          artifacts: [],
          scopeProbe: await probeScopes(caller, options.probeTypes ?? [], workItemKey),
          errorCode: spine.errorCode,
          traversalMs: Date.now() - started,
          evidenceSource: 'graph',
        };
      }

      const pageAris = spine.rows.filter((r) => r.type === 'confluence-page').map((r) => r.ari);

      const branches = await runPersistedQuery(caller, keys.branches, { pageAris, limit: 25 }, (rows) =>
        mapBranchRows(rows, fallback),
      );

      const outcomes = keys.outcomes
        ? await runPersistedQuery(caller, keys.outcomes, { limit: 25 }, (rows) =>
            mapOutcomeRows(rows, fallback),
          )
        : { rows: [] as RawArtifact[], pages: 0, truncated: false, errorCode: null };

      const artifacts = [...spine.rows, ...branches.rows, ...outcomes.rows];
      const scopeProbe =
        artifacts.length === 0
          ? await probeScopes(caller, options.probeTypes ?? [], workItemKey)
          : [];

      return {
        artifacts,
        scopeProbe,
        errorCode: branches.errorCode ?? outcomes.errorCode,
        traversalMs: Date.now() - started,
        evidenceSource: 'graph',
      };
    },
  };
}
