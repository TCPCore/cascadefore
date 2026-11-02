import { describe, expect, it } from 'vitest';
import { buildGraft, buildPaths, decide, rankPaths } from '../src/domain/graft.js';
import { DEFAULT_INTENT } from '../src/domain/intent.js';
import type { Intent } from '../src/shared/types.js';
import { NOW, branchShard, branchTaken, branches, nodeAdr, nodeTransition, nodes, spine } from './fixtures/scenario.js';

const weeksIntent: Intent = { ...DEFAULT_INTENT, goal: 'restore service this week', horizon: 'weeks', source: 'user' };
const yearsIntent: Intent = {
  ...DEFAULT_INTENT,
  goal: 'reduce long-term maintenance burden over the next year',
  horizon: 'years',
  source: 'user',
};

function run(intent: Intent) {
  const paths = rankPaths(buildPaths(nodes, branches, spine, intent, { now: NOW }));
  return { paths, recommendation: decide(paths, branches, spine, intent) };
}

describe('path ranking', () => {
  it('recommends the low-migration path when the horizon is a week', () => {
    const { recommendation } = run(weeksIntent);
    expect(recommendation.kind).toBe('graft');
    if (recommendation.kind !== 'graft') return;
    expect(recommendation.best.branchId).toBe('br_taken');
  });

  it('recommends the structurally better path when the horizon is a year', () => {
    const { recommendation } = run(yearsIntent);
    expect(recommendation.kind).toBe('graft');
    if (recommendation.kind !== 'graft') return;
    expect(recommendation.best.branchId).toBe('br_shard');
  });

  it('produces genuinely different answers from identical evidence', () => {
    const a = run(weeksIntent).recommendation;
    const b = run(yearsIntent).recommendation;
    expect(a.kind).toBe('graft');
    expect(b.kind).toBe('graft');
    if (a.kind !== 'graft' || b.kind !== 'graft') return;
    expect(a.best.branchId).not.toBe(b.best.branchId);
    // Both remain defensible: neither answer is disqualified.
    expect(a.best.disqualified).toBe(false);
    expect(b.best.disqualified).toBe(false);
  });

  it('does not veto when the tagged constraint is still satisfied', () => {
    const intent: Intent = {
      ...weeksIntent,
      hardConstraints: ['must not add a dependency #no-new-dependency'],
    };
    const { paths, recommendation } = run(intent);
    // Every dependency is alive by default, so the tag must not fire.
    expect(paths.filter((p) => p.disqualified)).toHaveLength(0);
    expect(recommendation.kind).toBe('graft');
  });

  it('vetoes a path whose dependency is no longer resolvable', () => {
    const intent: Intent = {
      ...weeksIntent,
      hardConstraints: ['must not add a dependency #no-new-dependency'],
    };
    const paths = buildPaths(nodes, branches, spine, intent, {
      now: NOW,
      dependencyAlive: (ari) => !ari.includes('payments'),
    });
    const shard = paths.find((p) => p.branchId === 'br_shard');
    expect(shard?.disqualified).toBe(true);
    expect(shard?.vetoReason).toMatch(/dependency/i);
  });

  it('returns noEvidencedPath when every path is vetoed', () => {
    const intent: Intent = {
      ...weeksIntent,
      hardConstraints: ['must not add a dependency #no-new-dependency'],
    };
    const deadBranches = branches.map((b) => ({
      ...b,
      requiredDependencies: ['ari:cloud:compass::component/payments'],
    }));
    const paths = buildPaths(nodes, deadBranches, spine, intent, {
      now: NOW,
      dependencyAlive: () => false,
    });
    const rec = decide(rankPaths(paths), deadBranches, spine, intent);
    expect(rec.kind).toBe('noEvidencedPath');
    if (rec.kind !== 'noEvidencedPath') return;
    expect(rec.failingCriterion.length).toBeGreaterThan(0);
    expect(rec.note).toMatch(/unsupported/i);
  });

  it('names an unmapped hard constraint rather than guessing', () => {
    const intent: Intent = {
      ...weeksIntent,
      hardConstraints: ['must satisfy the auditors'],
    };
    const paths = buildPaths(nodes, [], spine, intent, { now: NOW });
    const rec = decide(rankPaths(paths), [], spine, intent);
    expect(rec.kind).toBe('noEvidencedPath');
    if (rec.kind !== 'noEvidencedPath') return;
    expect(rec.failingCriterion).toMatch(/could not be evaluated/i);
  });
});

describe('graft assembly', () => {
  it('keeps the prefix, grafts the branch, unwinds only contradicted segments', () => {
    const paths = rankPaths(buildPaths(nodes, branches, spine, weeksIntent, { now: NOW }));
    const shard = paths.find((p) => p.branchId === 'br_shard');
    expect(shard).toBeDefined();
    if (!shard) return;

    const graft = buildGraft(shard, branchShard, spine);
    expect(graft.graft.branchId).toBe('br_shard');
    expect(graft.keep.map((k) => k.nodeId)).toContain(nodeAdr.id);
    expect(graft.unwind).toHaveLength(1);
    expect(graft.unwind[0]?.nodeId).toBe(nodeTransition.id);
  });

  it('never recommends a full revert when nothing is contradicted', () => {
    const paths = rankPaths(buildPaths(nodes, branches, spine, weeksIntent, { now: NOW }));
    const taken = paths.find((p) => p.branchId === 'br_taken');
    expect(taken).toBeDefined();
    if (!taken) return;
    const graft = buildGraft(taken, branchTaken, spine);
    expect(graft.unwind).toHaveLength(0);
  });
});
