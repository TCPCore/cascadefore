import { describe, expect, it } from 'vitest';

import { buildTimeline, timelineAsOf } from '../src/domain/timeline';
import { treeAt, describeTree } from '../src/domain/asOf';
import type { Branch, DecisionNode, Evidence } from '../src/shared/types';
import type { EventContext } from '../src/domain/events';

function ev(ari: string, createdAt: string, title = 'evidence'): Evidence {
  return {
    ari,
    type: 'confluence-comment',
    title,
    createdAt,
    sourceAuthority: 1,
    independenceKey: ari,
    implementationProof: false,
    outcome: 'unknown',
  } as unknown as Evidence;
}

const anchor: EventContext = {
  kind: 'build-failure',
  subjectKey: 'CX-11',
  subjectAri: 'ari:issue/CX-11',
  title: 'Checkout build failed',
  at: '2026-11-02T12:07:46.770Z',
};

function node(over: Partial<DecisionNode> & { id: string; decidedAt: string }): DecisionNode {
  return {
    ari: `ari:page/${over.id}`,
    kind: 'thread',
    title: `decision ${over.id}`,
    actorAris: [],
    confidence: 0.72,
    evidence: [],
    ...over,
  } as DecisionNode;
}

function branch(over: Partial<Branch> & { id: string; nodeId: string }): Branch {
  return {
    label: `branch ${over.id}`,
    taken: false,
    evidence: [],
    downstreamNodeIds: [],
    requiredDependencies: [],
    unwindsNodeIds: [],
    ...over,
  } as Branch;
}

describe('forensic timeline', () => {
  const early = node({
    id: 'n1',
    decidedAt: '2022-03-26T00:21:59.292Z',
    evidence: [
      ev('ari:comment/a', '2022-03-26T00:15:54.357Z', 'proposal'),
    ],
  });
  const late = node({ id: 'n2', decidedAt: '2026-10-01T00:00:00.000Z' });

  it('orders entries chronologically from the anchor', () => {
    const timeline = buildTimeline({ anchor, anchorAt: anchor.at, nodes: [late, early], branches: [] });
    const times = timeline.entries.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('marks what was knowable at the anchor and what was not', () => {
    const timeline = buildTimeline({ anchor, anchorAt: anchor.at, nodes: [early, late], branches: [] });
    const entry = (id: string) => timeline.entries.find((e) => e.id === id)!;
    expect(entry('node:n1').knowableAtAnchor).toBe(true);
    expect(entry('node:n2').knowableAtAnchor).toBe(true); // 2026-10 still before Nov anchor
    expect(timeline.knowableThen + timeline.learnedSince).toBe(timeline.entries.length);
  });

  it('marks evidence after the anchor as learned since', () => {
    const future = node({
      id: 'n3',
      decidedAt: '2027-01-01T00:00:00.000Z',
      evidence: [
        ev('ari:comment/z', '2027-01-01T00:00:00.000Z', 'later'),
      ],
    });
    const timeline = buildTimeline({ anchor, anchorAt: anchor.at, nodes: [future], branches: [] });
    expect(timeline.entries.find((e) => e.id === 'evidence:ari:comment/z')?.knowableAtAnchor).toBe(false);
    expect(timeline.learnedSince).toBeGreaterThan(0);
  });

  it('dates a branch by its earliest evidence and marks the taken one as resolution', () => {
    const b = branch({
      id: 'b1',
      nodeId: 'n1',
      taken: true,
      label: 'add Finance',
      evidence: [
        ev('ari:comment/b', '2022-03-26T00:15:54.357Z'),
        ev('ari:comment/c', '2022-03-26T00:21:59.292Z'),
      ],
    });
    const timeline = buildTimeline({ anchor, anchorAt: anchor.at, nodes: [early], branches: [b] });
    const entry = timeline.entries.find((e) => e.id === 'branch:b1')!;
    expect(entry.kind).toBe('resolution');
    expect(entry.at).toBe('2022-03-26T00:15:54.357Z');
  });

  it('truncates to any moment — the as-of view', () => {
    const timeline = buildTimeline({ anchor, anchorAt: anchor.at, nodes: [early, late], branches: [] });
    const past = timelineAsOf(timeline, '2023-01-01T00:00:00.000Z');
    expect(past.entries.some((e) => e.id === 'node:n1')).toBe(true);
    expect(past.entries.some((e) => e.id === 'node:n2')).toBe(false);
    expect(past.learnedSince).toBe(0);
  });
});

describe('tree at a moment', () => {
  const early = node({ id: 'n1', decidedAt: '2022-03-26T00:21:59.292Z' });
  const late = node({ id: 'n2', decidedAt: '2026-10-01T00:00:00.000Z' });

  const taken = branch({
    id: 'b1',
    nodeId: 'n1',
    taken: true,
    label: 'add Finance',
    evidence: [ev('ari:c/1', '2022-03-26T00:15:54.357Z')],
  });
  const future = branch({
    id: 'b2',
    nodeId: 'n2',
    label: 'shard by tenant',
    evidence: [ev('ari:c/2', '2026-06-06T00:00:00.000Z')],
  });

  it('shows only decisions made by that date', () => {
    const snapshot = treeAt({ nodes: [early, late], branches: [] }, '2023-01-01T00:00:00.000Z');
    expect(snapshot.decided.map((n) => n.id)).toEqual(['n1']);
  });

  it('reports paths still open at that date', () => {
    const snapshot = treeAt({ nodes: [early, late], branches: [taken, future] }, '2023-01-01T00:00:00.000Z');
    expect(snapshot.openBranches.map((b) => b.id)).toEqual(['b2']);
  });

  it('hides evidence that had not happened yet', () => {
    const snapshot = treeAt({ nodes: [early, late], branches: [taken, future] }, '2023-01-01T00:00:00.000Z');
    expect(snapshot.branches.map((b) => b.id)).toEqual(['b1']);
    expect(snapshot.futureEvidenceAris).toContain('ari:c/2');
  });

  it('states the finding in plain language', () => {
    const snapshot = treeAt({ nodes: [early, late], branches: [taken, future] }, '2023-01-01T00:00:00.000Z');
    const text = describeTree(snapshot);
    expect(text).toMatch(/1 decision/);
    expect(text).toMatch(/1 path\(s\) still open/);
    expect(text).toMatch(/did not exist yet/);
  });

  it('says plainly when nothing had been decided', () => {
    const snapshot = treeAt({ nodes: [early], branches: [taken] }, '2020-01-01T00:00:00.000Z');
    expect(describeTree(snapshot)).toMatch(/no decision had been made/i);
  });
});
