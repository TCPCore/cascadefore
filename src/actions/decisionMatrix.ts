import { buildMatrix } from '../decisions/matrix';
import { computeCaseBase } from '../decisions/service';

/**
 * The matrix primitive: one aggregate over the decision index.
 *
 * Deliberately an aggregate rather than a row dump — it is the "all areas" view,
 * and it is fast because the index is ours.
 */
export async function decisionMatrixAction(event: unknown): Promise<Record<string, unknown>> {
  const record =
    event && typeof event === 'object'
      ? (((event as Record<string, unknown>).input ??
          (event as Record<string, unknown>).payload ??
          event) as Record<string, unknown>)
      : {};

  const groupBy = record.groupBy === 'status' ? 'status' : 'area';

  try {
    const { models } = await computeCaseBase();
    return buildMatrix(models, groupBy) as unknown as Record<string, unknown>;
  } catch (error) {
    return {
      error: 'MATRIX_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
