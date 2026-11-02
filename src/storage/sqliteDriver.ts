import { DatabaseSync } from 'node:sqlite';

import type { SqlDriver } from './driver';

/**
 * Local SQL driver.
 *
 * Forge SQL is TiDB — MySQL-compatible, in-cloud, and only reachable from the
 * Forge runtime. That used to mean the schema and every statement were blind
 * until a deploy.
 *
 * `node:sqlite` gives us a real SQL engine in-process, so DDL and queries are
 * parsed and executed for real during development. It is not a TiDB emulator:
 * anything dialect-specific (`ON DUPLICATE KEY UPDATE`, `AUTO_INCREMENT`,
 * `JSON` columns) simply will not run here, which is the point — the case-base
 * schema is written portable so it runs on both.
 *
 *   CASCADE_STORE=sqlite npx tsx scripts/serve.ts
 */
export function createSqliteDriver(path = ':memory:'): SqlDriver {
  const db = new DatabaseSync(path);

  return {
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
      const statement = db.prepare(text);
      const values = params.map((value) => (value === undefined ? null : value)) as never[];

      // node:sqlite distinguishes row-returning statements from mutations.
      if (/^\s*(select|with|pragma)\b/i.test(text)) {
        return statement.all(...values) as Row[];
      }
      statement.run(...values);
      return [] as Row[];
    },

    async ddl(text: string): Promise<void> {
      db.exec(text);
    },
  };
}

/** Escapes a value for the rare case a statement is assembled by hand. */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}
