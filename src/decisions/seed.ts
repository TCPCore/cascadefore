import { parseDecision } from './parse';
import type { Decision } from './types';
import type { ExecutorRegistry } from './runner';
import type { FileMatchTest } from './types';

/**
 * A small, honest corpus.
 *
 * Five decisions about the same datastore, in decision order, arranged so the
 * growth curve actually moves: three hold, a fourth is violated, a fifth holds
 * again. Nothing here is randomised — every number the demo shows is
 * reproducible from these strings.
 */

const FIXTURE_FILES: Record<string, string> = {
  'infra/docker-compose.yml': `services:\n  db:\n    image: postgres:16\n    ports: ["5432:5432"]\n`,
  'config/session.yml': `driver: redis\nhost: cache-01\n`,
  'src/db/repository.ts': `export function save(row) {\n  db.query('INSERT INTO ledger (id, amount) VALUES (?, ?)', row);\n}\n`,
};

const D0012 = `
id: 0012-use-postgres-primary
decision: Use Postgres as the primary datastore
decided_at: 2026-03-14T10:00:00Z
decided_by: [alice@example.com, bob@example.com]
domain: [datastore, persistence]
constraints: ["#no-downtime", "#acid-required"]
rationale: |
  The billing ledger needs ACID guarantees. Postgres gives transactions,
  foreign keys and a replication story the team already operates.
alternatives:
  - name: SQLite
    rejected_because: no concurrent writers
    outcome: never_tried
  - name: MongoDB
    rejected_because: weak ACID at the time
    outcome: unknown
tests:
  - name: primary datastore image is postgres
    kind: file_match
    target: infra/docker-compose.yml
    pattern: "image:\\\\s*postgres:"
    on_fail: The datastore image changed. If intentional, update this record.
evidence:
  links:
    - type: jira_issue
      key: ARCH-123
`;

const D0018 = `
id: 0018-redis-for-sessions
decision: Use Redis for session storage
decided_at: 2026-04-02T09:30:00Z
decided_by: [carol@example.com]
domain: [datastore, cache]
constraints: ["#no-downtime"]
rationale: Sessions need sub-millisecond reads and a TTL. Redis is already operated.
tests:
  - name: session driver is redis
    kind: file_match
    target: config/session.yml
    pattern: "driver:\\\\s*redis"
`;

const D0023 = `
id: 0023-no-orm-raw-sql
decision: No ORM; explicit SQL in the repository layer
decided_at: 2026-05-19T14:00:00Z
decided_by: [alice@example.com]
domain: [datastore, persistence]
constraints: ["#no-downtime"]
rationale: |
  Query plans matter for the ledger. An ORM hides the plan and the team has
  been burned by N+1s before.
tests:
  - name: repository writes raw SQL
    kind: file_match
    target: src/db/repository.ts
    pattern: "INSERT INTO"
`;

const D0031 = `
id: 0031-datastore-monitoring
decision: Every datastore must ship with pg_stat_statements monitoring
decided_at: 2026-06-30T11:00:00Z
decided_by: [bob@example.com]
domain: [datastore, observability]
constraints: ["#no-downtime"]
rationale: We cannot reason about slow queries we cannot see.
tests:
  - name: monitoring config declares pg_stat_statements
    kind: file_match
    target: infra/monitoring/datastore.yaml
    pattern: "pg_stat_statements"
    on_fail: Nobody added the monitoring config. This decision is not being followed.
`;

const D0044 = `
id: 0044-kafka-for-events
decision: Publish ledger events to Kafka
decided_at: 2026-08-11T16:45:00Z
decided_by: [dan@example.com]
domain: [datastore, messaging]
constraints: ["#no-downtime"]
rationale: Downstream consumers need the event stream, not the table.
tests:
  - name: confirmed with the platform team
    kind: manual
    note: Ownership sits with the platform team; no automated check exists yet.
`;

export const SEED_DOCUMENTS = [D0012, D0018, D0023, D0031, D0044];

export function loadSeedDecisions(): Decision[] {
  return SEED_DOCUMENTS.map(parseDecision);
}

/** Executors backed by an in-memory file map, so the demo runs with no repo. */
export function createFixtureExecutors(files: Record<string, string> = FIXTURE_FILES): ExecutorRegistry {
  return {
    file_match: async (test) => {
      const fileTest = test as FileMatchTest;
      const contents = files[fileTest.target];
      if (contents === undefined) {
        return { passed: false, evidence: `file not found: ${fileTest.target}` };
      }
      let pattern: RegExp;
      try {
        pattern = new RegExp(fileTest.pattern);
      } catch {
        return { passed: false, evidence: `invalid pattern: ${fileTest.pattern}` };
      }
      const passed = pattern.test(contents);
      return {
        passed,
        evidence: passed
          ? `matched /${fileTest.pattern}/ in ${fileTest.target}`
          : `no match for /${fileTest.pattern}/ in ${fileTest.target}`,
      };
    },
  };
}

export { FIXTURE_FILES };
