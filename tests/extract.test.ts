import { describe, expect, it } from 'vitest';
import {
  assemble,
  classifyArtifact,
  synthesizeImplicitNode,
  toEvidence,
  type RawArtifact,
} from '../src/graph/extract';
import { IMPLICIT_CONFIDENCE_CAP } from '../src/domain/constants';
import { ev } from './fixtures/scenario';

function artifact(overrides: Partial<RawArtifact>): RawArtifact {
  return {
    ari: 'ari:cloud:confluence::page/X',
    type: 'confluence-page',
    title: 'A page',
    createdAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('decision synthesis', () => {
  it('classifies an ADR with an options section at high confidence', () => {
    const result = classifyArtifact(
      artifact({ title: 'ADR-014: keep the schema', bodyText: 'Options considered: shard or not.' }),
    );
    expect(result).toMatchObject({ kind: 'documented', confidence: 0.9 });
  });

  it('classifies an ADR title without an options section lower', () => {
    const result = classifyArtifact(artifact({ title: 'Decision record: schema' }));
    expect(result).toMatchObject({ kind: 'documented', confidence: 0.75 });
  });

  it('classifies an options section without an ADR title lower still', () => {
    const result = classifyArtifact(artifact({ title: 'Schema notes', bodyText: 'Alternatives considered: two.' }));
    expect(result).toMatchObject({ kind: 'documented', confidence: 0.7 });
  });

  it('refuses to call an ordinary page a decision', () => {
    expect(classifyArtifact(artifact({ title: 'Team offsite photos' }))).toBeNull();
  });

  it('recognises a resolved comment thread', () => {
    const result = classifyArtifact(
      artifact({
        type: 'confluence-comment',
        title: 'thread',
        bodyText: "we'll go with the sharded option",
        replyCount: 5,
      }),
    );
    expect(result?.kind).toBe('thread');
    expect(result?.confidence).toBeGreaterThan(0.6);
    expect(result?.confidence).toBeLessThanOrEqual(0.8);
  });

  it('recognises an unresolved thread but scores it lower', () => {
    const resolved = classifyArtifact(
      artifact({ type: 'confluence-comment', bodyText: 'decided: shard', replyCount: 4 }),
    );
    const unresolved = classifyArtifact(
      artifact({ type: 'confluence-comment', bodyText: 'what about sharding?', replyCount: 4 }),
    );
    expect(unresolved?.kind).toBe('thread');
    expect(unresolved!.confidence).toBeLessThan(resolved!.confidence);
  });

  it('ignores a two-reply comment', () => {
    expect(classifyArtifact(artifact({ type: 'confluence-comment', replyCount: 2 }))).toBeNull();
  });

  it('treats a workflow transition as a decision', () => {
    expect(classifyArtifact(artifact({ type: 'jira-status' }))?.kind).toBe('transition');
  });

  it.each(['external-build', 'external-deployment', 'external-pull-request', 'goal'] as const)(
    'never treats %s as a decision',
    (type) => {
      expect(classifyArtifact(artifact({ type }))).toBeNull();
    },
  );

  it('caps implicit-node confidence', () => {
    const node = synthesizeImplicitNode('ari:cloud:compass::component/x', artifact({}), 'No decision recorded');
    expect(node).not.toBeNull();
    expect(node!.confidence).toBeLessThanOrEqual(IMPLICIT_CONFIDENCE_CAP);
    expect(node!.kind).toBe('implicit');
  });
});

describe('evidence mapping', () => {
  it('uses the author as the independence key when present', () => {
    const evidence = toEvidence(artifact({ authorAri: 'ari:cloud:identity::user/a' }));
    expect(evidence.independenceKey).toBe('ari:cloud:identity::user/a');
  });

  it('falls back to the component, then the ARI', () => {
    expect(toEvidence(artifact({ componentAri: 'ari:cloud:compass::component/c' })).independenceKey).toBe(
      'ari:cloud:compass::component/c',
    );
    expect(toEvidence(artifact({})).independenceKey).toBe('ari:cloud:confluence::page/X');
  });

  it('carries implementation proof and outcome through', () => {
    const evidence = toEvidence(
      artifact({ type: 'external-build', implementationProof: true, outcome: 'passed' }),
    );
    expect(evidence.implementationProof).toBe(true);
    expect(evidence.outcome).toBe('passed');
  });
});

describe('assembly', () => {
  const artifacts: RawArtifact[] = [
    artifact({
      ari: 'ari:cloud:confluence::page/ADR-2',
      title: 'ADR-2: unsharded schema',
      createdAt: '2026-03-12T00:00:00.000Z',
      bodyText: 'Options considered: shard or not.',
      areaKey: 'billing',
      dependentCount: 4,
    }),
    artifact({
      ari: 'ari:cloud:confluence::page/ADR-1',
      title: 'ADR-1: sharded schema',
      createdAt: '2026-03-10T00:00:00.000Z',
      bodyText: 'Alternatives considered: unsharded.',
      areaKey: 'billing',
    }),
    artifact({
      ari: 'ari:cloud:external::build/9',
      type: 'external-build',
      title: 'build 9',
      createdAt: '2026-09-01T00:00:00.000Z',
      areaKey: 'billing',
      implementationProof: true,
      outcome: 'passed',
    }),
  ];

  it('orders the spine closest-to-failure first', () => {
    const { spine } = assemble(artifacts, '2026-10-01T00:00:00.000Z');
    expect(spine).toHaveLength(2);
    expect(spine[0]!.ari).toContain('ADR-2');
    expect(spine[1]!.ari).toContain('ADR-1');
    expect(spine[0]!.order).toBe(0);
  });

  it('carries dependentCount into the spine', () => {
    const { spine } = assemble(artifacts, '2026-10-01T00:00:00.000Z');
    expect(spine[0]!.dependentCount).toBe(4);
  });

  it('makes the earliest decision the taken path and later ones alternatives', () => {
    const { branches } = assemble(artifacts, '2026-10-01T00:00:00.000Z');
    const taken = branches.filter((b) => b.taken);
    const alts = branches.filter((b) => !b.taken);
    expect(taken).toHaveLength(1);
    expect(taken[0]!.label).toContain('ADR-2');
    expect(alts.map((a) => a.label)).toContain('ADR-1: sharded schema');
  });

  it('unwinds every decision closer to the failure', () => {
    const { branches } = assemble(artifacts, '2026-10-01T00:00:00.000Z');
    const alt = branches.find((b) => !b.taken);
    expect(alt?.unwindsNodeIds).toHaveLength(1);
  });

  it('attaches a passing build as implementation proof on the alternative', () => {
    const { branches } = assemble(artifacts, '2026-10-01T00:00:00.000Z');
    const alt = branches.find((b) => !b.taken);
    const proof = alt?.evidence.filter((e) => e.implementationProof) ?? [];
    expect(proof).toHaveLength(1);
    expect(proof[0]!.outcome).toBe('passed');
  });

  it('never attaches outcome evidence to the taken branch', () => {
    const { branches } = assemble(artifacts, '2026-10-01T00:00:00.000Z');
    const taken = branches.find((b) => b.taken);
    expect(taken?.evidence.some((e) => e.type === 'external-build')).toBe(false);
  });

  it('returns an empty assembly when nothing is decision-shaped', () => {
    const { nodes, spine, branches } = assemble([ev('x', 'external-build', '2026-01-01T00:00:00.000Z')], '2026-02-01T00:00:00.000Z');
    expect(nodes).toHaveLength(0);
    expect(spine).toHaveLength(0);
    expect(branches).toHaveLength(0);
  });
});
