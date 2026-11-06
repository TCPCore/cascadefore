import { repository } from '../bootstrap';
import { projectTree, type Direction, type TreeProjection } from '../domain/treeProjection';

/**
 * The projection primitive.
 *
 * One function serves both surfaces — the MCP action and the panel resolver —
 * for the same reason `buildRunView` does: two implementations drift, and the
 * drift shows up as an empty panel with no error.
 */
export interface ProjectionRequest {
  runId: string;
  asOf?: string;
  direction?: Direction | string;
  depth?: number | string;
}

export async function projectTreeFor(request: ProjectionRequest): Promise<
  | { ok: true; projection: TreeProjection }
  | { ok: false; error: string; message: string }
> {
  if (!request.runId) {
    return { ok: false, error: 'NO_RUN_ID', message: 'Pass a runId returned by reconstruct-decision.' };
  }

  const snapshot = await repository().get(request.runId);
  if (!snapshot) {
    return { ok: false, error: 'NOT_FOUND', message: `No run ${request.runId} for this installation.` };
  }

  const depth =
    request.depth === undefined || request.depth === ''
      ? undefined
      : Number.parseInt(String(request.depth), 10);

  return {
    ok: true,
    projection: projectTree({
      snapshot,
      asOf: request.asOf || undefined,
      direction: request.direction === 'forward' ? 'forward' : 'backward',
      depth: Number.isFinite(depth) ? depth : undefined,
    }),
  };
}

export async function projectTreeAction(event: unknown): Promise<Record<string, unknown>> {
  const input = extractInput(event);
  const result = await projectTreeFor({ ...input, runId: input.runId ?? '' });
  if (!result.ok) return { error: result.error, message: result.message };
  return result.projection as unknown as Record<string, unknown>;
}

interface Input {
  runId?: string;
  asOf?: string;
  direction?: string;
  depth?: number | string;
}

function extractInput(event: unknown): Input {
  if (!event || typeof event !== 'object') return {} as Input;
  const record = event as Record<string, unknown>;
  const candidate = (record.input ?? record.payload ?? record) as Record<string, unknown>;

  return {
    runId: typeof candidate.runId === 'string' ? candidate.runId : undefined,
    asOf: typeof candidate.asOf === 'string' ? candidate.asOf : undefined,
    direction: typeof candidate.direction === 'string' ? candidate.direction : undefined,
    depth:
      typeof candidate.depth === 'string' || typeof candidate.depth === 'number'
        ? (candidate.depth as string | number)
        : undefined,
  };
}
