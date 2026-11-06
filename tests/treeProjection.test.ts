import { describe, expect, it } from 'vitest';

import { projectTree } from '../src/domain/treeProjection';
import type { BranchViewDto, RunSnapshotDto, TreeNodeDto } from '../src/shared/dtos';

function node(id: string, decidedAt: string): TreeNodeDto {
  return { id, ari: `ari:page/${id}`, kind: 'thread' as never, title: `decision ${id}`, decidedAt, confidence: 0.7, evidenceCount: 1 };
}

function branch(
  id: string,
  nodeId: string,
  evidenceAt: string[],
  over: Partial<BranchViewDto> = {},
): BranchViewDto {
  return {
    id,
    nodeId,
    label: `branch ${id}`,
    taken: false,
    score: { knowability: 0.5, viability: 0.5, gap: 0, knowableEvidenceAris: [], withheldEvidenceAris: [] } as never,
    evidenceArIs: evidenceAt.map((_, index) => `ari#${index}`),
    evidenceAt,
    projection: null,
    consequence: [],
    ...over,
  };
}

function snapshot(over: Partial<RunSnapshotDto> = {}): RunSnapshotDto {
  return {
    runId: 'run_1',
    workItemKey: 'CX-11',
    evidenceSource: 'seeded_fixture',
    counterfactuals: [],
    event: {
      kind: 'build-failure',
      subjectKey: 'CX-11',
      subjectAri: 'ari:issue/CX-11',
      title: 'Build failure CX-11',
      at: '2026-11-02T00:00:00.000Z',
    },
    failureAt: '2026-11-02T00:00:00.000Z',
    status: 'loaded',
    stage: 'done',
    intent: { goal: 'restore', horizon: 'weeks', constraints: [], source: 'inferred' } as never,
    nodes: [
      node('n1', '2022-03-26T00:00:00.000Z'),
      node('n2', '2024-01-01T00:00:00.000Z'),
      node('n3', '2026-06-01T00:00:00.000Z'),
    ],
    spine: [],
    branches: [
      branch('b1', 'n1', ['2022-03-20T00:00:00.000Z'], { taken: true }),
      branch('b2', 'n1', ['2025-05-05T00:00:00.000Z']),
    ],
    thenNow: [],
    paths: [],
    recommendation: null,
    graft: null,
    scopeProbe: [],
    stats: { nodeCount: 3, branchCount: 2, evidenceCount: 1, traversalMs: 1, scoringMs: 1 } as never,
    dossierUrl: null,
    ...over,
  } as RunSnapshotDto;
}

describe('tree projection', () => {
  it('projects only decisions that existed at the anchor', () => {
    const projection = projectTree({ snapshot: snapshot(), asOf: '2025-01-01T00:00:00.000Z' });
    expect(projection.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(projection.counts.nodes).toBe(2);
  });

  it('shows alternatives that existed and hides those that did not', () => {
    const projection = projectTree({ snapshot: snapshot(), asOf: '2025-01-01T00:00:00.000Z' });
    const first = projection.nodes.find((n) => n.id === 'n1')!;
    expect(first.visibleAlternatives.map((a) => a.id)).toEqual(['b1']);
    expect(first.hiddenAlternatives.map((a) => a.id)).toEqual(['b2']);
  });

  it('reports what could not have been known at the anchor', () => {
    const projection = projectTree({ snapshot: snapshot(), asOf: '2025-01-01T00:00:00.000Z' });
    expect(projection.invisibleAfter).toBe('2025-05-05T00:00:00.000Z');
  });

  it('says plainly when nothing had been decided yet', () => {
    const projection = projectTree({ snapshot: snapshot(), asOf: '2020-01-01T00:00:00.000Z' });
    expect(projection.nodes).toHaveLength(0);
    expect(projection.summary).toMatch(/no decision had been made/i);
  });

  it('respects depth so a projection is bounded', () => {
    const projection = projectTree({ snapshot: snapshot(), depth: 1 });
    expect(projection.nodes).toHaveLength(1);
    expect(projection.nodes[0]?.id).toBe('n3');
  });

  it('links consecutive decisions when walking backward', () => {
    const projection = projectTree({ snapshot: snapshot(), direction: 'backward' });
    expect(projection.edges.every((edge) => edge.kind === 'preceded')).toBe(true);
    expect(projection.edges.length).toBe(projection.nodes.length - 1);
  });

  it('follows declared downstream links when walking forward', () => {
    const withLinks = snapshot({
      branches: [
        branch('b1', 'n1', ['2022-03-20T00:00:00.000Z'], {
          taken: true,
          downstreamNodeIds: ['n2'],
          unwindsNodeIds: ['n3'],
        }),
      ],
    });
    const projection = projectTree({ snapshot: withLinks, direction: 'forward' });
    expect(projection.edges.some((e) => e.kind === 'constrained' && e.to === 'n2')).toBe(true);
    expect(projection.edges.some((e) => e.kind === 'superseded' && e.to === 'n3')).toBe(true);
  });

  it('defaults the anchor to the failure moment', () => {
    const projection = projectTree({ snapshot: snapshot() });
    expect(projection.anchor.asOf).toBe('2026-11-02T00:00:00.000Z');
    expect(projection.nodes).toHaveLength(3);
  });

  it('is deterministic: same input, same output', () => {
    const a = projectTree({ snapshot: snapshot(), asOf: '2025-01-01T00:00:00.000Z' });
    const b = projectTree({ snapshot: snapshot(), asOf: '2025-01-01T00:00:00.000Z' });
    expect(a).toEqual(b);
  });
});
