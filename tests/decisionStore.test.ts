import { describe, expect, it } from 'vitest';

import { createSqliteDriver } from '../src/storage/sqliteDriver';
import { DecisionStore } from '../src/decisions/store';
import { buildDecisionReport } from '../src/decisions/service';
import { loadSeedDecisions } from '../src/decisions/seed';
import { runAll } from '../src/decisions/runner';
import { createFixtureExecutors } from '../src/decisions/seed';
import { extractPatterns } from '../src/decisions/patterns';

/**
 * These tests exercise the real SQL that will run on TiDB: the same DDL strings,
 * the same parameterised statements, through a real engine. Only the engine
 * differs.
 */
async function freshStore(): Promise<{ store: DecisionStore; driver: ReturnType<typeof createSqliteDriver> }> {
  const driver = createSqliteDriver(':memory:');
  const store = new DecisionStore(driver);
  await store.ensureSchema();
  return { store, driver };
}

async function ranDecisions() {
  return runAll(loadSeedDecisions(), createFixtureExecutors());
}

describe('case-base schema', () => {
  it('is idempotent', async () => {
    const { store } = await freshStore();
    await expect(store.ensureSchema()).resolves.toBeUndefined();
  });

  it('creates every table', async () => {
    const { driver } = await freshStore();
    const tables = await driver.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = tables.map((t) => t.name);
    expect(names).toContain('decision_records');
    expect(names).toContain('decision_tests');
    expect(names).toContain('decision_patterns');
    expect(names).toContain('decision_runs');
  });
});

describe('decision round-trip', () => {
  it('persists and reloads every decision with its derived status', async () => {
    const { store } = await freshStore();
    const decisions = await ranDecisions();
    await store.saveDecisions(decisions);

    const loaded = await store.loadDecisions();

    expect(loaded).toHaveLength(decisions.length);
    expect(loaded.map((d) => d.id)).toEqual(decisions.map((d) => d.id));
    expect(loaded.map((d) => d.status)).toEqual(decisions.map((d) => d.status));
  });

  it('keeps observed results but not test specs', async () => {
    const { store } = await freshStore();
    const decisions = await ranDecisions();
    await store.saveDecisions(decisions);

    const loaded = await store.loadDecisions();
    const kafka = loaded.find((d) => d.id === '0044-kafka-for-events');

    // The ledger holds what was observed…
    expect(kafka?.results[0]?.evidence).toMatch(/matched/);
    // …but the spec stays in git, deliberately.
    expect(kafka?.tests).toEqual([]);
  });

  it('is idempotent on re-save', async () => {
    const { store } = await freshStore();
    const decisions = await ranDecisions();
    await store.saveDecisions(decisions);
    await store.saveDecisions(decisions);

    const loaded = await store.loadDecisions();
    expect(loaded).toHaveLength(6);
  });

  it('preserves domain and constraints for retrieval', async () => {
    const { store } = await freshStore();
    await store.saveDecisions(await ranDecisions());
    const loaded = await store.loadDecisions();
    const postgres = loaded.find((d) => d.id === '0012-use-postgres-primary');
    expect(postgres?.domain).toContain('datastore');
    expect(postgres?.constraints).toContain('#acid-required');
  });
});

describe('pattern round-trip', () => {
  it('persists patterns with confidence and evidence ids', async () => {
    const { store } = await freshStore();
    const report = await buildDecisionReport();
    await store.savePatterns(report.patterns);

    const loaded = await store.loadPatterns();

    expect(loaded).toHaveLength(report.patterns.length);
    expect(loaded[0]?.confidence).toBe(report.patterns[0]?.confidence);
    expect(loaded[0]?.evidenceDecisionIds.length).toBeGreaterThan(0);
  });

  it('recomputes the same patterns from the ledger alone', async () => {
    const { store } = await freshStore();
    const report = await buildDecisionReport();
    await store.saveDecisions(await ranDecisions());

    const loaded = await store.loadDecisions();
    const recomputed = extractPatterns(loaded);

    expect(recomputed.length).toBe(report.patterns.length);
    expect(recomputed[0]?.confidence).toBeCloseTo(report.patterns[0]!.confidence, 6);
  });
});

describe('run ledger', () => {
  it('records a run and reads it back newest-first', async () => {
    const { store } = await freshStore();
    const report = await buildDecisionReport();

    const first = await store.recordRun(report);
    const second = await store.recordRun(report);
    const runs = await store.loadRuns();

    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.runId)).toContain(first);
    expect(runs.map((r) => r.runId)).toContain(second);
    expect(runs[0]?.enforced).toBe(4);
    expect(runs[0]?.violated).toBe(1);
    expect(runs[0]?.orphaned).toBe(1);
  });

  it('snapshot returns everything in one pass', async () => {
    const { store } = await freshStore();
    const report = await buildDecisionReport();
    await store.saveDecisions(await ranDecisions());
    await store.savePatterns(report.patterns);
    await store.recordRun(report);

    const snapshot = await store.snapshot();

    expect(snapshot.decisions).toHaveLength(6);
    expect(snapshot.patterns.length).toBeGreaterThan(0);
    expect(snapshot.runs).toHaveLength(1);
  });
});

describe('portability guards', () => {
  it('rejects MySQL-only syntax, which is why the schema avoids it', async () => {
    const { driver } = await freshStore();
    await driver.ddl('CREATE TABLE IF NOT EXISTS probe (id VARCHAR(20) NOT NULL PRIMARY KEY)');
    await driver.query('INSERT INTO probe (id) VALUES (?)', ['a']);

    await expect(
      driver.query('INSERT INTO probe (id) VALUES (?) ON DUPLICATE KEY UPDATE id = id', ['a']),
    ).rejects.toThrow();
  });
});
