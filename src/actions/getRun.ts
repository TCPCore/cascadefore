import { repository } from '../bootstrap';
import { buildRunView } from './runView';

/**
 * Reads a persisted reconstruction back.
 *
 * The reconstruct action returns a summary and a run id; this is how a caller —
 * or the Rovo agent — fetches the detail without re-running anything. It is
 * real surface, not scaffolding: the run already exists in Forge SQL.
 */
export async function getRunAction(event: unknown): Promise<Record<string, unknown>> {
  const input = extractInput(event);
  if (!input.runId) {
    return { error: 'NO_RUN_ID', message: 'Pass a runId returned by reconstruct-decision.' };
  }

  const snapshot = await repository().get(input.runId);
  if (!snapshot) {
    return { error: 'NOT_FOUND', message: `No run ${input.runId} for this installation.` };
  }

  return buildRunView(snapshot);
}

interface Input {
  runId?: string;
}

function extractInput(event: unknown): Input {
  if (!event || typeof event !== 'object') return {};
  const record = event as Record<string, unknown>;
  const candidate = (record.input ?? record.payload ?? record) as Record<string, unknown>;
  return typeof candidate.runId === 'string' ? { runId: candidate.runId } : {};
}
