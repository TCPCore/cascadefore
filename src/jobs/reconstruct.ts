import type { AsyncEvent } from '@forge/events';
import { buildDeps, isDemoMode, repository } from '../bootstrap';
import { loadConfig } from '../config';
import { runPipeline } from '../pipeline/run';
import type { Horizon } from '../shared/types';

export interface ReconstructJobBody extends Record<string, unknown> {
  runId: string;
  workItemKey: string;
  failureAt: string;
  createdAt: string;
  intentText?: string;
  horizon?: Horizon;
}

/**
 * Async consumer. Runs the reconstruction off the 25-second resolver budget and
 * persists the snapshot; the panel polls `getRun` for the result.
 */
export async function reconstructHandler(event: AsyncEvent<ReconstructJobBody>): Promise<void> {
  const body = event.body;
  const repo = repository();
  const config = loadConfig();

  try {
    const deps = buildDeps(config);
    const result = await runPipeline(
      {
        runId: body.runId,
        workItemKey: body.workItemKey,
        intentText: body.intentText,
        horizon: body.horizon,
        failureAt: body.failureAt,
        createdAt: body.createdAt,
      },
      {
        ...deps,
        onStage: async (stage) => {
          await repo.setStage(body.runId, stage);
        },
      },
    );

    await repo.save(result.snapshot, result.nodes);
  } catch (error) {
    const code = error instanceof Error && error.message.includes('not configured') ? 'NOT_CONFIGURED' : 'JOB_FAILED';
    if (isDemoMode() && code === 'JOB_FAILED') {
      // In demo mode a failure is a bug, not a configuration problem; surface it.
      throw error;
    }
    await repo.fail(body.runId, code);
  }
}
