/**
 * Storage abstraction.
 *
 * The runtime driver lives in `forgeDriver.ts` so tests never import
 * `@forge/sql` (it expects the Forge runtime). Everything below is pure.
 */

export interface SqlDriver {
  query<Row = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<Row[]>;
  ddl(text: string): Promise<void>;
}

export class InMemorySqlDriver implements SqlDriver {
  readonly ddlLog: string[] = [];
  readonly queries: Array<{ text: string; params: readonly unknown[] }> = [];
  constructor(private readonly handler: (text: string, params: readonly unknown[]) => unknown[] = () => []) {}

  async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
    this.queries.push({ text, params });
    return this.handler(text, params) as Row[];
  }

  async ddl(text: string): Promise<void> {
    this.ddlLog.push(text);
  }
}
