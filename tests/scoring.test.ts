import { describe, expect, it } from 'vitest';
import { independenceDiscounts, scoreBranch, scoreBranches } from '../src/domain/scoring.js';
import { branchShard, branchTaken, branchWithheld, branches, nodeAdr, nodes } from './fixtures/scenario.js';

describe('independence discount', () => {
  it('discounts repeated evidence from the same key', () => {
    const d = independenceDiscounts([
      { ...evStub('a'), independenceKey: 'k1' },
      { ...evStub('b'), independenceKey: 'k1' },
      { ...evStub('c'), independenceKey: 'k2' },
    ]);
    expect(d.get('k1')).toBeCloseTo(1 / Math.sqrt(2), 6);
    expect(d.get('k2')).toBe(1);
  });

  function evStub(id: string) {
    return {
      ari: `ari:${id}`,
      type: 'confluence-comment' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      title: id,
      sourceAuthority: 0.6,
      independenceKey: id,
      implementationProof: false,
      outcome: 'unknown' as const,
    };
  }
});

describe('branch scoring', () => {
  it('scores the taken branch from evidence that all predates the decision', () => {
    const score = scoreBranch(branchTaken, nodeAdr);
    expect(score.withheldEvidenceAris).toHaveLength(0);
    expect(score.knowability).toBeGreaterThan(0);
    expect(score.confidence).toBe(Math.min(score.knowability, score.viability));
  });

  it('gives zero knowability to a branch whose evidence all postdates the decision', () => {
    const score = scoreBranch(branchWithheld, nodeAdr);
    expect(score.knowability).toBe(0);
    expect(score.viability).toBeGreaterThan(0);
    expect(score.gap).toBeCloseTo(score.viability, 5);
    expect(score.withheldEvidenceAris).toHaveLength(2);
  });

  it('separates knowable from withheld evidence on a mixed branch', () => {
    const score = scoreBranch(branchShard, nodeAdr);
    expect(score.knowableEvidenceAris).toHaveLength(1);
    expect(score.withheldEvidenceAris).toHaveLength(1);
  });

  it('rewards implementation proof in viability', () => {
    const shard = scoreBranch(branchShard, nodeAdr);
    const taken = scoreBranch(branchTaken, nodeAdr);
    expect(shard.viability).toBeGreaterThan(taken.viability);
  });

  it('clamps scores into 0..1', () => {
    for (const s of scoreBranches(nodes, branches)) {
      expect(s.knowability).toBeGreaterThanOrEqual(0);
      expect(s.knowability).toBeLessThanOrEqual(1);
      expect(s.viability).toBeGreaterThanOrEqual(0);
      expect(s.viability).toBeLessThanOrEqual(1);
    }
  });

  it('emits inspectable arithmetic for every score', () => {
    const score = scoreBranch(branchShard, nodeAdr);
    expect(score.arithmetic.length).toBeGreaterThanOrEqual(6);
    expect(score.arithmetic.some((s) => s.label === 'W_k')).toBe(true);
    expect(score.arithmetic.some((s) => s.label === 'Gap')).toBe(true);
    for (const step of score.arithmetic) {
      expect(Number.isFinite(step.value)).toBe(true);
      expect(step.expression.length).toBeGreaterThan(0);
    }
  });

  it('drops orphan branches instead of rendering them', () => {
    const orphan = { ...branchTaken, id: 'br_orphan', nodeId: 'node_missing' };
    const scores = scoreBranches(nodes, [...branches, orphan]);
    expect(scores.find((s) => s.branchId === 'br_orphan')).toBeUndefined();
  });
});
