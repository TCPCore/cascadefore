import { createHash, randomUUID } from 'node:crypto';

/**
 * Deterministic identifier so the same evidence always yields the same node id
 * across runs. Renderers depend on this for stable React keys and for
 * de-duplicating nodes discovered by more than one traversal.
 */
export function stableId(prefix: string, ...parts: string[]): string {
  const h = createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 16);
  return `${prefix}_${h}`;
}

/** Sortable, collision-resistant within a tenant. */
export function newRunId(): string {
  const ts = Date.now().toString(36);
  return `run_${ts}_${randomUUID().slice(0, 8)}`;
}
