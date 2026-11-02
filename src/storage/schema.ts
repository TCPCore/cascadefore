import type { SqlDriver } from './driver';

/** Tables are prefixed so a shared per-install database never collides. */
export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS cascade_runs (
    run_id VARCHAR(64) NOT NULL PRIMARY KEY,
    work_item_key VARCHAR(64) NOT NULL,
    work_item_ari VARCHAR(255) NOT NULL,
    failure_at DATETIME NOT NULL,
    status VARCHAR(24) NOT NULL,
    stage VARCHAR(24) NOT NULL,
    event_json JSON,
    intent_json JSON,
    intent_source VARCHAR(24),
    spine_json JSON,
    recommendation_json JSON,
    stats_json JSON,
    scope_probe_json JSON,
    dossier_url VARCHAR(1024),
    error_code VARCHAR(64),
    created_at DATETIME NOT NULL,
    completed_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS cascade_nodes (
    run_id VARCHAR(64) NOT NULL,
    node_id VARCHAR(64) NOT NULL,
    ari VARCHAR(255) NOT NULL,
    kind VARCHAR(24) NOT NULL,
    title VARCHAR(512) NOT NULL,
    decided_at DATETIME NOT NULL,
    confidence DOUBLE NOT NULL,
    evidence_count INT NOT NULL,
    PRIMARY KEY (run_id, node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS cascade_evidence (
    run_id VARCHAR(64) NOT NULL,
    ari VARCHAR(255) NOT NULL,
    node_id VARCHAR(64),
    type VARCHAR(32) NOT NULL,
    title VARCHAR(512) NOT NULL,
    created_at DATETIME NOT NULL,
    authority DOUBLE NOT NULL,
    independence_key VARCHAR(255) NOT NULL,
    proof TINYINT NOT NULL,
    outcome VARCHAR(16) NOT NULL,
    PRIMARY KEY (run_id, ari)
  )`,
  `CREATE TABLE IF NOT EXISTS cascade_branches (
    run_id VARCHAR(64) NOT NULL,
    branch_id VARCHAR(64) NOT NULL,
    node_id VARCHAR(64) NOT NULL,
    label VARCHAR(255) NOT NULL,
    taken TINYINT NOT NULL,
    score_json JSON NOT NULL,
    PRIMARY KEY (run_id, branch_id)
  )`,
  `CREATE TABLE IF NOT EXISTS cascade_paths (
    run_id VARCHAR(64) NOT NULL,
    path_id VARCHAR(64) NOT NULL,
    branch_id VARCHAR(64) NOT NULL,
    rank_no INT NOT NULL,
    score DOUBLE NOT NULL,
    disqualified TINYINT NOT NULL,
    path_json JSON NOT NULL,
    PRIMARY KEY (run_id, path_id)
  )`,
];

/**
 * Additive migrations for tables that already exist. Each is attempted
 * independently and ignored if the column is already there, because
 * `CREATE TABLE IF NOT EXISTS` will never alter an existing table.
 */
export const COLUMN_MIGRATIONS: string[] = [
  `ALTER TABLE cascade_runs ADD COLUMN event_json JSON`,
];

/**
 * DDL is not transactional and `CREATE TABLE IF NOT EXISTS` is idempotent, so
 * this is safe to call on every cold start. It is guarded by a module-level
 * promise to avoid five round-trips per invocation.
 */
let schemaReady: Promise<void> | null = null;

export async function ensureSchema(driver: SqlDriver): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const statement of DDL) {
        await driver.ddl(statement);
      }
      for (const migration of COLUMN_MIGRATIONS) {
        try {
          await driver.ddl(migration);
        } catch {
          // Column already exists — expected on every run after the first.
        }
      }
    })().catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

export function resetSchemaCacheForTests(): void {
  schemaReady = null;
}
