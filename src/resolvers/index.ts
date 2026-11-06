import Resolver from '@forge/resolver';

import { buildDeps, isDemoMode, jobQueue, repository } from '../bootstrap';
import { loadConfig } from '../config';
import { runPipeline } from '../pipeline/run';
import { newRunId } from '../shared/ids';
import { buildDecisionReport, findSimilarFor } from '../decisions/service';
import { loadSeedDecisions } from '../decisions/seed';
import { buildCorpusCounterfactuals } from '../decisions/counterfactuals';
import { buildRunView } from '../actions/runView';
import { projectTreeFor } from '../actions/projectTree';
import { createConfluenceSource } from '../graph/confluenceThread';
import api, { route } from '@forge/api';
import type { Horizon, Intent } from '../shared/types';

interface StartPayload {
  workItemKey?: string;
  /** A Confluence page id: reconstruct the decision from its real thread. */
  pageId?: string;
  intentText?: string;
  horizon?: Horizon;
}

interface ResolverRequest<T> {
  payload: T;
  context?: { extension?: { issue?: { key?: string } } };
}

const resolver = new Resolver();

const FALLBACK_INTENT: Intent = {
  goal: 'Restore the build and reduce the chance of repeating this failure',
  successCriteria: [],
  hardConstraints: [],
  softPreferences: [],
  nonGoals: [],
  horizon: 'weeks',
  source: 'inferred',
};

/**
 * Creates a run and enqueues the reconstruction. Returns immediately: the panel
 * polls `getRun`, so the 25-second resolver budget is never a factor.
 */
resolver.define('startCascade', async (request: ResolverRequest<StartPayload>) => {
  const config = loadConfig();
  const workItemKey =
    request.payload?.workItemKey ?? request.context?.extension?.issue?.key ?? '';

  if (!workItemKey) {
    return { error: 'NO_WORK_ITEM', message: 'Open Cascade from a Jira work item.' };
  }

  if (!isDemoMode() && (!config.queryKeys.spine || !config.queryKeys.branches || !config.queryKeys.outcomes)) {
    return {
      error: 'NOT_CONFIGURED',
      message:
        'Cascade has no registered Teamwork Graph queries. Run `npm run register:queries` or set CASCADE_DEMO_MODE=true.',
    };
  }

  const runId = newRunId();
  const createdAt = new Date().toISOString();
  const repo = repository();

  await repo.create(runId, workItemKey, createdAt, {
    ...FALLBACK_INTENT,
    ...(request.payload?.horizon ? { horizon: request.payload.horizon } : {}),
  });

  // Inline mode runs the reconstruction inside the resolver. It is the right
  // trade for a seeded demo graph (sub-second) and removes any dependency on
  // queue propagation during a recorded demo. Async remains the default.
  if (process.env.CASCADE_INLINE === 'true') {
    // A page id switches the source to the live Confluence thread, so the
    // reconstruction is built from comments a user actually wrote.
    const pageId = request.payload?.pageId;
    const deps = pageId
      ? {
          ...buildDeps(config),
          source: createConfluenceSource(pageId, async (path: string) => {
            const response = await api.asUser().requestConfluence(path as never);
            return response.json();
          }),
        }
      : buildDeps(config);

    const result = await runPipeline(
      {
        runId,
        workItemKey,
        intentText: request.payload?.intentText ?? '',
        horizon: request.payload?.horizon ?? 'weeks',
        failureAt: createdAt,
        createdAt,
      },
      deps,
    );
    await repo.save(result.snapshot, result.nodes);
    return { runId };
  }

  await jobQueue().push({
    body: {
      runId,
      workItemKey,
      failureAt: createdAt,
      createdAt,
      intentText: request.payload?.intentText ?? '',
      horizon: request.payload?.horizon ?? 'weeks',
    },
  });

  return { runId };
});

/**
 * Recent records, so the panel offers choices instead of demanding a key.
 *
 * Jira first, then Confluence; both as the acting user, so the list is exactly
 * what that person is allowed to see. Failures return an empty list with a
 * reason rather than an error — a picker that cannot load must not stop the
 * reconstruction from working manually.
 */
resolver.define('recentWorkItems', async () => {
  type IssueBody = {
    issues?: Array<{
      key?: string;
      fields?: { summary?: string; created?: string; status?: { name?: string } };
    }>;
  };

  const shape = (body: IssueBody) => ({
    items: (body.issues ?? [])
      .filter((issue) => issue.key)
      .map((issue) => ({
        key: issue.key as string,
        summary: issue.fields?.summary ?? '',
        status: issue.fields?.status?.name ?? '',
        createdAt: issue.fields?.created ?? '',
      })),
    error: null as string | null,
  });

  try {
    // Enhanced search first (current API), then the classic endpoint. Atlassian
    // has been retiring the old one, so trying both is the difference between a
    // picker and an empty list.
    const enhanced = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        jql: 'order by created DESC',
        maxResults: 25,
        fields: ['summary', 'status', 'created'],
      }),
    });

    if (enhanced.ok) return shape((await enhanced.json()) as IssueBody);

    const classic = await api.asUser().requestJira(
      route`/rest/api/3/search?jql=order by created DESC&maxResults=25&fields=summary,status,created`,
    );
    if (classic.ok) return shape((await classic.json()) as IssueBody);

    return { items: [], error: `JIRA_SEARCH_${enhanced.status}/${classic.status}` };
  } catch (error) {
    return { items: [], error: error instanceof Error ? error.message : String(error) };
  }
});

resolver.define('recentPages', async () => {
  try {
    const response = await api.asUser().requestConfluence(
      route`/wiki/api/v2/pages?sort=-created-date&limit=25`,
    );
    if (!response.ok) {
      return { items: [], error: `CONFLUENCE_PAGES_${response.status}` };
    }
    const body = (await response.json()) as {
      results?: Array<{ id?: string; title?: string; createdAt?: string }>;
    };

    return {
      items: (body.results ?? [])
        .filter((page) => page.id)
        .map((page) => ({
          id: page.id as string,
          title: page.title ?? '',
          createdAt: page.createdAt ?? '',
        })),
      error: null,
    };
  } catch (error) {
    return { items: [], error: error instanceof Error ? error.message : String(error) };
  }
});

resolver.define('attribution', async () => ({
  // No verified path exists from a work item to a build (see GRAPH-BOUNDARY),
  // so there is nothing to attribute from the graph. Reporting an empty summary
  // is the truthful answer; an error here just broke the case-base view.
  decisions: [],
  builds: 0,
  workItems: 0,
  pullRequests: 0,
  deployments: 0,
  failedBuilds: 0,
  events: [],
}));

resolver.define('recentRuns', async () => {
  try {
    return { runs: await repository().listRecent(15), error: null };
  } catch (error) {
    return { runs: [], error: error instanceof Error ? error.message : String(error) };
  }
});

resolver.define('getRun', async (request: ResolverRequest<{ runId: string }>) => {
  const runId = request.payload?.runId;
  if (!runId) return { error: 'NO_RUN', message: 'Missing run id.' };

  const snapshot = await repository().get(runId);
  if (!snapshot) return { error: 'NOT_FOUND', message: 'That run no longer exists.' };

  return buildRunView(snapshot);
});

/**
 * The case base, for the Forge-hosted panel and the Rovo agent.
 *
 * Currently computed from the bundled corpus. Once the Confluence mirror is
 * live, this switches to ingesting `Decision record:` pages — the ingest and
 * round-trip are already built and tested (`src/mirror/ingest.ts`); only the
 * REST read is outstanding.
 */
resolver.define('projectTree', async (request: ResolverRequest<{
  runId?: string;
  asOf?: string;
  direction?: string;
  depth?: number;
}>) => {
  const result = await projectTreeFor({
    runId: request.payload?.runId ?? '',
    asOf: request.payload?.asOf,
    direction: request.payload?.direction,
    depth: request.payload?.depth,
  });

  return result.ok ? result.projection : { error: result.error, message: result.message };
});

resolver.define('caseCounterfactuals', async () => {
  try {
    return { rows: buildCorpusCounterfactuals(loadSeedDecisions()), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  }
});

resolver.define('decisionReport', async () => {
  return buildDecisionReport(loadSeedDecisions());
});

resolver.define('similarDecisions', async (request: ResolverRequest<{ id: string }>) => {
  const id = request.payload?.id;
  if (!id) return { id: '', similar: [] };
  return findSimilarFor(id, loadSeedDecisions());
});

/** Cheap health check the panel calls on mount to pick its empty state. */
resolver.define('health', async () => {
  const config = loadConfig();
  return {
    demoMode: isDemoMode(),
    configured: Boolean(config.queryKeys.spine && config.queryKeys.branches && config.queryKeys.outcomes),
    probeTypes: config.probeTypes,
  };
});

/** Exposed to the panel for the intent form's default copy. */
resolver.define('defaultIntent', async () => ({ intent: FALLBACK_INTENT }));

export const handler = resolver.getDefinitions();
