import { describe, expect, it } from 'vitest';

import { buildDecisionReport, findSimilarFor } from '../src/decisions/service';
import { loadSeedDecisions } from '../src/decisions/seed';
import { confidenceOf, DEFAULT_PATTERN_OPTIONS } from '../src/decisions/patterns';
import { statusOf } from '../src/decisions/runner';
import { findSimilar, contextOf, similarity, termsOf } from '../src/decisions/retrieval';

describe('decision parsing', () => {
  it('parses every seed document', () => {
    const decisions = loadSeedDecisions();
    expect(decisions).toHaveLength(6);
    for (const d of decisions) {
      expect(d.id).toMatch(/^\d{4}-/);
      expect(d.domain.length).toBeGreaterThan(0);
      expect(d.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('never trusts an authored status', () => {
    // status is a computed field; parse always starts it at unknown
    expect(loadSeedDecisions().every((d) => d.status === 'unknown')).toBe(true);
  });
});

describe('test lifecycle', () => {
  it('derives enforced / violated / orphaned from results alone', () => {
    expect(statusOf([{ name: 'a', kind: 'file_match', passed: true, skipped: false, durationMs: 1, evidence: '' }])).toBe('enforced');
    expect(statusOf([{ name: 'a', kind: 'file_match', passed: false, skipped: false, durationMs: 1, evidence: '' }])).toBe('violated');
    expect(statusOf([{ name: 'a', kind: 'manual', passed: false, skipped: true, durationMs: 0, evidence: '' }])).toBe('orphaned');
    expect(statusOf([])).toBe('orphaned');
  });

  it('ignores manual tests when a real test exists', () => {
    const mixed = [
      { name: 'a', kind: 'file_match' as const, passed: true, skipped: false, durationMs: 1, evidence: '' },
      { name: 'b', kind: 'manual' as const, passed: false, skipped: true, durationMs: 0, evidence: '' },
    ];
    expect(statusOf(mixed)).toBe('enforced');
  });
});

describe('confidence', () => {
  it('applies Laplace smoothing rather than raw ratios', () => {
    expect(confidenceOf(3, 0)).toBe(0.8); // 4/5, not 1.0
    expect(confidenceOf(3, 1)).toBeCloseTo(0.667, 3); // 4/6
    expect(confidenceOf(4, 1)).toBeCloseTo(0.714, 3); // 5/7
    expect(confidenceOf(0, 0)).toBe(0.5); // no evidence, no certainty
  });
});

describe('retrieval', () => {
  it('drops stopwords and short tokens', () => {
    const terms = termsOf('We use the Postgres database for our ledger');
    expect(terms).toContain('postgres');
    expect(terms).toContain('ledger');
    expect(terms).not.toContain('the');
  });

  it('explains every match in words', () => {
    const [a, b] = loadSeedDecisions();
    const result = similarity(contextOf(a!), contextOf(b!));
    expect(result.score).toBeGreaterThan(0);
    expect(result.because.length).toBeGreaterThan(0);
    expect(result.because.join(' ')).toMatch(/shared/);
  });

  it('ranks a same-domain decision above an unrelated one', async () => {
    const decisions = loadSeedDecisions();
    const postgres = decisions[0]!;
    const ranked = findSimilar(postgres, decisions, 5);
    expect(ranked[0]?.decision.domain).toContain('datastore');
    expect(ranked.every((r) => r.decision.id !== postgres.id)).toBe(true);
  });
});

describe('pattern extraction', () => {
  it('does not fire below the support threshold', async () => {
    const report = await buildDecisionReport(loadSeedDecisions().slice(0, 2));
    expect(report.patterns).toHaveLength(0);
  });

  it('fires once three decisions share a part and agree', async () => {
    const report = await buildDecisionReport(loadSeedDecisions().slice(0, 3));
    expect(report.patterns.length).toBeGreaterThan(0);
    const top = report.patterns[0]!;
    expect(top.confirmations).toBe(3);
    expect(top.refutations).toBe(0);
    expect(top.confidence).toBe(0.8);
  });

  it('drops confidence when the fourth decision is violated', async () => {
    const report = await buildDecisionReport(loadSeedDecisions().slice(0, 4));
    const enforced = report.patterns.find((p) => p.confirmations === 3 && p.refutations === 1);
    expect(enforced?.confidence).toBeCloseTo(0.667, 3);
  });

  it('recovers when a fifth decision holds', async () => {
    const report = await buildDecisionReport(loadSeedDecisions().slice(0, 5));
    const enforced = report.patterns.find((p) => p.confirmations === 4 && p.refutations === 1);
    expect(enforced?.confidence).toBeCloseTo(0.714, 3);
  });

  it('is flat when an orphaned decision is added', async () => {
    const five = await buildDecisionReport(loadSeedDecisions().slice(0, 5));
    const six = await buildDecisionReport(loadSeedDecisions());
    expect(six.patterns[0]?.confidence).toBe(five.patterns[0]?.confidence);
  });
});

describe('decision report', () => {
  it('classifies the seeded corpus', async () => {
    const report = await buildDecisionReport();
    expect(report.counts.enforced).toBe(4);
    expect(report.counts.violated).toBe(1);
    expect(report.counts.orphaned).toBe(1);
    expect(report.testability.rate).toBeCloseTo(0.833, 3);
  });

  it('produces a growth curve with one point per decision', async () => {
    const report = await buildDecisionReport();
    expect(report.growth).toHaveLength(6);
    expect(report.growth.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(report.growth[0]?.top).toBeNull();
    expect(report.growth[2]?.top?.confidence).toBe(0.8);
  });

  it('records why a decision was violated', async () => {
    const report = await buildDecisionReport();
    const violated = report.decisions.find((d) => d.status === 'violated');
    expect(violated?.id).toBe('0031-datastore-monitoring');
    const failed = violated?.results.find((r) => !r.passed && !r.skipped);
    expect(failed?.evidence).toMatch(/file not found|no match/);
  });

  it('marks the manual-only decision as orphaned with no runnable test', async () => {
    const report = await buildDecisionReport();
    const orphan = report.decisions.find((d) => d.status === 'orphaned');
    expect(orphan?.id).toBe('0055-feature-flags-for-rewrite');
    expect(orphan?.skipped).toBe(1);
    expect(orphan?.passed).toBe(0);
  });

  it('finds similar decisions with reasons', async () => {
    const result = await findSimilarFor('0012-use-postgres-primary');
    expect(result.similar.length).toBeGreaterThan(0);
    expect(result.similar[0]?.because.join(' ')).toMatch(/shared/);
  });

  it('returns an empty list for an unknown id', async () => {
    const result = await findSimilarFor('does-not-exist');
    expect(result.similar).toEqual([]);
  });
});

describe('pattern options', () => {
  it('keeps the ratio guard and a structural floor', () => {
    expect(DEFAULT_PATTERN_OPTIONS.minSupport).toBe(3);
    expect(DEFAULT_PATTERN_OPTIONS.minRatio).toBeGreaterThan(0);
    expect(DEFAULT_PATTERN_OPTIONS.similarityFloor).toBeLessThanOrEqual(0.5);
  });
});
