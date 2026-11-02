/**
 * Case-base schema.
 *
 * Deliberately portable ANSI-ish SQL so the same DDL runs on TiDB (Forge SQL)
 * and on the local `node:sqlite` sandbox:
 *
 *  - no `AUTO_INCREMENT` — Forge docs warn it hot-spots on TiDB; ids are strings
 *  - no `JSON` column type — payloads are `TEXT` holding JSON
 *  - no `ON DUPLICATE KEY UPDATE` — writes are delete-then-insert, so the
 *    semantics are identical on both engines
 *  - no foreign keys — Forge SQL does not support them
 *
 * That constraint is a feature: a schema that runs identically in both places
 * cannot surprise us at deploy time.
 */
export const DECISION_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS decision_records (
    id VARCHAR(128) NOT NULL PRIMARY KEY,
    decision TEXT NOT NULL,
    decided_at VARCHAR(32) NOT NULL,
    decided_by_json TEXT,
    domain_json TEXT,
    constraints_json TEXT,
    rationale TEXT,
    alternatives_json TEXT,
    evidence_json TEXT,
    status VARCHAR(16) NOT NULL,
    last_run_at VARCHAR(32),
    repo VARCHAR(255)
  )`,
  `CREATE TABLE IF NOT EXISTS decision_tests (
    decision_id VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    kind VARCHAR(24) NOT NULL,
    passed INTEGER NOT NULL,
    skipped INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    evidence TEXT,
    on_fail TEXT,
    PRIMARY KEY (decision_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS decision_patterns (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    pattern_text TEXT NOT NULL,
    domain_json TEXT,
    constraints_json TEXT,
    evidence_ids_json TEXT,
    confidence DOUBLE NOT NULL,
    confirmations INTEGER NOT NULL,
    refutations INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS decision_runs (
    run_id VARCHAR(64) NOT NULL PRIMARY KEY,
    ran_at VARCHAR(32) NOT NULL,
    enforced INTEGER NOT NULL,
    violated INTEGER NOT NULL,
    orphaned INTEGER NOT NULL,
    testability DOUBLE NOT NULL
  )`,
];
