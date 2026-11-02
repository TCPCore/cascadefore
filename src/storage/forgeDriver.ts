import { sql } from '@forge/sql';
import type { SqlDriver } from './driver';

interface SqlResult<Row> {
  rows: Row[];
}

/**
 * Real driver. `@forge/sql` exposes a prepared-statement client:
 *   sql.prepare<Row>(text).bindParams(...params).execute() → { rows }
 * DDL goes through a separate endpoint and is not transactional.
 */
export const forgeSqlDriver: SqlDriver = {
  async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
    const statement = sql.prepare<Row>(text).bindParams(...params);
    const result = (await statement.execute()) as SqlResult<Row>;
    return result.rows ?? [];
  },
  async ddl(text: string): Promise<void> {
    await sql.executeDDL(text);
  },
};
