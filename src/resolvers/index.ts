import Resolver from '@forge/resolver';

import { buildDeps, isDemoMode, jobQueue, repository } from '../bootstrap';
import { loadConfig } from '../config';
import { runPipeline } from '../pipeline/run';
import { newRunId } from '../shared/ids';
import type { Horizon, Intent } from '../shared/types';

interface StartPayload {
  workItemKey?: string;
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
    const result = await runPipeline(
      {
        runId,
        workItemKey,
        intentText: request.payload?.intentText ?? '',
        horizon: request.payload?.horizon ?? 'weeks',
        failureAt: createdAt,
        createdAt,
      },
      buildDeps(config),
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

resolver.define('getRun', async (request: ResolverRequest<{ runId: string }>) => {
  const runId = request.payload?.runId;
  if (!runId) return { error: 'NO_RUN', message: 'Missing run id.' };

  const snapshot = await repository().get(runId);
  if (!snapshot) return { error: 'NOT_FOUND', message: 'That run no longer exists.' };

  return { snapshot };
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
