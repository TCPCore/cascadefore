import { parseDecision } from './parse';
import type { Decision } from './types';
import type { ExecutorRegistry } from './runner';
import type { FileMatchTest } from './types';

/**
 * A small, honest corpus.
 *
 * Six decisions in decision order, arranged so the growth curve actually moves:
 * three hold, the fourth is violated (confidence drops), the fifth holds again
 * (confidence recovers), and the sixth is orphaned (the curve does not move,
 * because a decision nobody can check teaches the case base nothing).
 *
 * Nothing here is randomised — every number the demo shows is reproducible from
 * these strings.
 */

const FIXTURE_FILES: Record<string, string> = {
  'infra/docker-compose.yml': `services:\n  db:\n    image: postgres:16\n    ports: ["5432:5432"]\n`,
  'config/session.yml': `driver: redis\nhost: cache-01\n`,
  'infra/kafka/topics.yaml': `topics:\n  - name: ledger.events\n    partitions: 12\n`,
  'src/db/repository.ts': `export function save(row) {\n  db.query('INSERT INTO ledger (id, amount) VALUES (?, ?)', row);\n}\n`,
  'infra/audit/mongo.yaml': `image: mongo:7\nreplicaSet: audit-rs\n`,
  'infra/ledger/mongo.yaml': `image: postgres:16\n`,
};


/**
 * Precedent for the MongoDB alternative rejected in 0012.
 *
 * These two exist so the counterfactual layer has something real to compare
 * against: one organisation-wide attempt that held, and one that had to be
 * reverted. They are seeded data and every surface labels them
 * `seeded_fixture` — the mechanism being demonstrated is the time gate, not the
 * provenance of these rows.
 */
const D0009 = `
id: 0009-mongodb-for-audit-logs
decision: Use MongoDB for audit log ingestion
decided_at: 2025-11-10T09:00:00Z
decided_by: [dana@example.com]
domain: [datastore, audit]
constraints: ["#no-downtime"]
rationale: |
  Audit logs are append-only, high volume and never joined. The team accepted
  eventual consistency here because nothing downstream reads them transactionally.
alternatives:
  - name: MongoDB
    rejected_because: n/a — this record took the MongoDB path
    outcome: tried_ok
tests:
  - name: audit store image is mongo
    kind: file_match
    target: infra/audit/mongo.yaml
    pattern: 'image: mongo:'
    on_fail: The audit store changed engine. If intentional, update this record.
evidence:
  links:
    - type: jira_issue
      key: ARCH-090
`;

const D0027 = `
id: 0027-mongodb-for-ledger
decision: Move the ledger to MongoDB for write throughput
decided_at: 2026-05-20T11:30:00Z
decided_by: [erin@example.com]
domain: [datastore, persistence]
constraints: ["#acid-required"]
rationale: |
  Write throughput was the constraint of the quarter, and the team expected the
  ledger to tolerate document storage. It did not: reconciliation depends on
  multi-row transactions, and the migration was reverted.
alternatives:
  - name: MongoDB
    rejected_because: reverted after two months — reconciliation needs transactions
    outcome: tried_bad
tests:
  - name: ledger store is not mongo
    kind: file_match
    target: infra/ledger/mongo.yaml
    pattern: 'image: postgres:'
    on_fail: The ledger moved to the document store again. If intentional, update this record.
evidence:
  links:
    - type: jira_issue
      key: ARCH-144
`;

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
    pattern: 'image: postgres:'
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
    pattern: 'driver: redis'
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
    pattern: 'INSERT INTO'
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
    pattern: 'pg_stat_statements'
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
  - name: ledger topic is declared
    kind: file_match
    target: infra/kafka/topics.yaml
    pattern: 'ledger.events'
`;

const D0055 = `
id: 0055-feature-flags-for-rewrite
decision: Gate the checkout rewrite behind a feature flag
decided_at: 2026-09-08T13:20:00Z
decided_by: [dan@example.com]
domain: [release, risk]
constraints: ["#no-downtime"]
rationale: The rewrite touches the payment path; a flag lets us dark-launch it.
tests:
  - name: flag reviewed with release engineering
    kind: manual
    note: A human signs off each rollout; there is no machine-checkable assertion yet.
`;

export const SEED_DOCUMENTS = [D0012, D0018, D0023, D0031, D0044, D0055];

/**
 * Precedent records — a separate slice, deliberately.
 *
 * The six decisions above are arranged so the growth curve tells a story
 * (three hold, one breaks, one recovers, one orphaned does not move the curve).
 * Adding records to that array would silently change every number the demo
 * shows. So the two MongoDB precedents live here instead, and only the
 * counterfactual layer reads them.
 */
export const PRECEDENT_DOCUMENTS = [D0009, D0027];

/** Everything the counterfactual layer may reason over: narrative corpus + precedent. */
export function loadDecisionCorpus(): Decision[] {
  return [...loadSeedDecisions(), ...loadPrecedentDecisions()];
}

export function loadPrecedentDecisions(): Decision[] {
  return PRECEDENT_DOCUMENTS.map((document) => parseDecision(document));
}

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
