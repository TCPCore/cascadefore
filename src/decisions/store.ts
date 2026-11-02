import type { SqlDriver } from '../storage/driver';
import { newRunId } from '../shared/ids';
import { DECISION_DDL } from './schema';
import type { Alternative, Decision, DecisionStatus, EvidenceLink, Pattern, TestResult } from './types';
import type { DecisionReport } from './service';

/**
 * The case base, persisted.
 *
 * Division of responsibility, which matters for the architecture:
 *
 *   git (`.decisions/*.decision`)  → the decision and its tests  (source of truth)
 *   this store                     → observed outcomes + status  (the ledger)
 *
 * The store never claims to hold the *definition* of a decision — a test spec
 * that exists only in a database is a test nobody can review. It holds what was
 * observed when the tests ran, which is exactly what the case base learns from.
 */

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function fromJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

interface DecisionRecordRow {
  id: string;
  decision: string;
  decided_at: string;
  decided_by_json: string | null;
  domain_json: string | null;
  constraints_json: string | null;
  rationale: string | null;
  alternatives_json: string | null;
  evidence_json: string | null;
  status: string;
  last_run_at: string | null;
  repo: string | null;
}

interface DecisionTestRow {
  decision_id: string;
  name: string;
  kind: string;
  passed: number;
  skipped: number;
  duration_ms: number;
  evidence: string | null;
  on_fail: string | null;
}

interface PatternRow {
  id: string;
  pattern_text: string;
  domain_json: string | null;
  constraints_json: string | null;
  evidence_ids_json: string | null;
  confidence: number;
  confirmations: number;
  refutations: number;
}

export interface StoreSnapshot {
  decisions: Decision[];
  patterns: Pattern[];
  runs: Array<{ runId: string; ranAt: string; enforced: number; violated: number; orphaned: number; testability: number }>;
}

export class DecisionStore {
  constructor(private readonly driver: SqlDriver) {}

  async ensureSchema(): Promise<void> {
    for (const statement of DECISION_DDL) {
      await this.driver.ddl(statement);
    }
  }

  /**
   * Portable upsert: delete-then-insert. `ON DUPLICATE KEY UPDATE` is MySQL-only
   * and would make the local sandbox diverge from production, which is the one
   * thing the sandbox exists to prevent.
   */
  async saveDecisions(decisions: readonly Decision[], repo = 'cascadefore'): Promise<void> {
    for (const decision of decisions) {
      await this.driver.query('DELETE FROM decision_records WHERE id = ?', [decision.id]);
      await this.driver.query(
        `INSERT INTO decision_records
          (id, decision, decided_at, decided_by_json, domain_json, constraints_json, rationale,
           alternatives_json, evidence_json, status, last_run_at, repo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          decision.id,
          decision.decision,
          decision.decidedAt,
          toJson(decision.decidedBy),
          toJson(decision.domain),
          toJson(decision.constraints),
          decision.rationale,
          toJson(decision.alternatives),
          toJson(decision.links),
          decision.status,
          decision.lastRunAt,
          repo,
        ],
      );

      await this.driver.query('DELETE FROM decision_tests WHERE decision_id = ?', [decision.id]);
      for (const result of decision.results) {
        await this.driver.query(
          `INSERT INTO decision_tests
            (decision_id, name, kind, passed, skipped, duration_ms, evidence, on_fail)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            decision.id,
            result.name,
            result.kind,
            result.passed ? 1 : 0,
            result.skipped ? 1 : 0,
            result.durationMs,
            result.evidence,
            result.onFail ?? null,
          ],
        );
      }
    }
  }

  async loadDecisions(): Promise<Decision[]> {
    const records = await this.driver.query<DecisionRecordRow>(
      'SELECT * FROM decision_records ORDER BY decided_at ASC',
    );
    const tests = await this.driver.query<DecisionTestRow>('SELECT * FROM decision_tests');

    const resultsByDecision = new Map<string, TestResult[]>();
    for (const row of tests) {
      const list = resultsByDecision.get(row.decision_id) ?? [];
      list.push({
        name: row.name,
        kind: row.kind as TestResult['kind'],
        passed: Boolean(row.passed),
        skipped: Boolean(row.skipped),
        durationMs: Number(row.duration_ms),
        evidence: row.evidence ?? '',
        ...(row.on_fail ? { onFail: row.on_fail } : {}),
      });
      resultsByDecision.set(row.decision_id, list);
    }

    return records.map((record) => ({
      id: record.id,
      decision: record.decision,
      decidedAt: record.decided_at,
      decidedBy: fromJson<string[]>(record.decided_by_json, []),
      domain: fromJson<string[]>(record.domain_json, []),
      constraints: fromJson<string[]>(record.constraints_json, []),
      rationale: record.rationale ?? '',
      alternatives: fromJson<Alternative[]>(record.alternatives_json, []),
      // Test *specs* live in git; the ledger holds only what was observed.
      tests: [],
      links: fromJson<EvidenceLink[]>(record.evidence_json, []),
      status: record.status as DecisionStatus,
      results: resultsByDecision.get(record.id) ?? [],
      lastRunAt: record.last_run_at,
    }));
  }

  async savePatterns(patterns: readonly Pattern[]): Promise<void> {
    await this.driver.query('DELETE FROM decision_patterns', []);
    for (const pattern of patterns) {
      await this.driver.query(
        `INSERT INTO decision_patterns
          (id, pattern_text, domain_json, constraints_json, evidence_ids_json,
           confidence, confirmations, refutations)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pattern.id,
          pattern.patternText,
          toJson(pattern.domain),
          toJson(pattern.constraints),
          toJson(pattern.evidenceDecisionIds),
          pattern.confidence,
          pattern.confirmations,
          pattern.refutations,
        ],
      );
    }
  }

  async loadPatterns(): Promise<Pattern[]> {
    const rows = await this.driver.query<PatternRow>(
      'SELECT * FROM decision_patterns ORDER BY confidence DESC',
    );
    return rows.map((row) => ({
      id: row.id,
      patternText: row.pattern_text,
      domain: fromJson<string[]>(row.domain_json, []),
      constraints: fromJson<string[]>(row.constraints_json, []),
      evidenceDecisionIds: fromJson<string[]>(row.evidence_ids_json, []),
      confidence: Number(row.confidence),
      confirmations: Number(row.confirmations),
      refutations: Number(row.refutations),
    }));
  }

  async recordRun(report: DecisionReport): Promise<string> {
    const runId = newRunId();
    await this.driver.query(
      `INSERT INTO decision_runs (run_id, ran_at, enforced, violated, orphaned, testability)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        runId,
        report.generatedAt,
        report.counts.enforced ?? 0,
        report.counts.violated ?? 0,
        report.counts.orphaned ?? 0,
        report.testability.rate,
      ],
    );
    return runId;
  }

  async loadRuns(): Promise<StoreSnapshot['runs']> {
    const rows = await this.driver.query<{
      run_id: string;
      ran_at: string;
      enforced: number;
      violated: number;
      orphaned: number;
      testability: number;
    }>('SELECT * FROM decision_runs ORDER BY ran_at DESC');

    return rows.map((row) => ({
      runId: row.run_id,
      ranAt: row.ran_at,
      enforced: Number(row.enforced),
      violated: Number(row.violated),
      orphaned: Number(row.orphaned),
      testability: Number(row.testability),
    }));
  }

  async snapshot(): Promise<StoreSnapshot> {
    const [decisions, patterns, runs] = await Promise.all([
      this.loadDecisions(),
      this.loadPatterns(),
      this.loadRuns(),
    ]);
    return { decisions, patterns, runs };
  }
}
