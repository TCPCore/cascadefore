import type {
  Branch,
  DecisionNode,
  Evidence,
  EvidenceType,
  Iso,
  SpineSegment,
} from '../../src/shared/types.js';
import { AUTHORITY } from '../../src/domain/constants.js';
import { stableId } from '../../src/shared/ids.js';

export function ev(
  id: string,
  type: EvidenceType,
  createdAt: Iso,
  overrides: Partial<Evidence> = {},
): Evidence {
  return {
    ari: `ari:cloud:${type.includes('confluence') ? 'confluence' : 'jira'}::${type}/${id}`,
    type,
    createdAt,
    title: `${type} ${id}`,
    sourceAuthority: AUTHORITY[type],
    independenceKey: `author-${id}`,
    implementationProof: false,
    outcome: 'unknown',
    ...overrides,
  };
}

export const FAILURE_AT = '2026-10-14T09:00:00.000Z';
export const NOW = '2026-11-01T12:00:00.000Z';

export const adrDecisionAt = '2026-03-14T09:12:00.000Z';
export const earlierDecisionAt = '2026-01-08T15:00:00.000Z';
export const laterDecisionAt = '2026-08-02T11:30:00.000Z';

export const nodeAdr: DecisionNode = {
  id: stableId('node', 'confluence-page', 'ADR-014'),
  ari: 'ari:cloud:confluence::page/ADR-014',
  kind: 'documented',
  title: 'ADR-014: keep the billing schema unsharded',
  decidedAt: adrDecisionAt,
  actorAris: ['ari:cloud:identity::user/alice'],
  confidence: 0.9,
  evidence: [ev('ADR-014', 'confluence-page', '2026-03-12T10:00:00.000Z')],
};

export const nodeEarlier: DecisionNode = {
  id: stableId('node', 'confluence-page', 'ADR-003'),
  ari: 'ari:cloud:confluence::page/ADR-003',
  kind: 'documented',
  title: 'ADR-003: adopt single-tenant schema per region',
  decidedAt: earlierDecisionAt,
  actorAris: ['ari:cloud:identity::user/bob'],
  confidence: 0.75,
  evidence: [ev('ADR-003', 'confluence-page', '2026-01-05T08:00:00.000Z')],
};

export const nodeTransition: DecisionNode = {
  id: stableId('node', 'jira-status', 'BILL-88'),
  ari: 'ari:cloud:jira::issue/BILL-88',
  kind: 'transition',
  title: 'BILL-88 closed as Done without a sharding spike',
  decidedAt: laterDecisionAt,
  actorAris: [],
  confidence: 0.5,
  evidence: [ev('BILL-88', 'jira-status', '2026-08-01T16:00:00.000Z')],
};

export const nodes: DecisionNode[] = [nodeAdr, nodeEarlier, nodeTransition];

export const spine: SpineSegment[] = [
  {
    nodeId: nodeTransition.id,
    ari: nodeTransition.ari,
    title: nodeTransition.title,
    order: 0,
    dependentCount: 2,
    resolved: false,
  },
  {
    nodeId: nodeAdr.id,
    ari: nodeAdr.ari,
    title: nodeAdr.title,
    order: 1,
    dependentCount: 2,
    resolved: true,
  },
  {
    nodeId: nodeEarlier.id,
    ari: nodeEarlier.ari,
    title: nodeEarlier.title,
    order: 2,
    dependentCount: 1,
    resolved: true,
  },
];

export const branchTaken: Branch = {
  id: 'br_taken',
  nodeId: nodeAdr.id,
  label: 'Keep the unsharded schema',
  taken: true,
  evidence: [
    ev('ADR-014', 'confluence-page', '2026-03-12T10:00:00.000Z'),
    ev('cmt-1', 'confluence-comment', '2026-03-13T09:00:00.000Z', {
      independenceKey: 'author-1',
    }),
  ],
  downstreamNodeIds: [nodeTransition.id],
  requiredDependencies: [],
  unwindsNodeIds: [],
};

export const branchShard: Branch = {
  id: 'br_shard',
  nodeId: nodeAdr.id,
  label: 'Adopt the sharded schema (sibling team, build passed)',
  taken: false,
  evidence: [
    ev('ADR-014-alt', 'confluence-comment', '2026-03-10T09:00:00.000Z', {
      independenceKey: 'author-carol',
    }),
    ev('build-77', 'external-build', '2026-09-20T09:00:00.000Z', {
      independenceKey: 'component-payments',
      implementationProof: true,
      outcome: 'passed',
    }),
  ],
  downstreamNodeIds: [],
  requiredDependencies: ['ari:cloud:compass::component/payments'],
  unwindsNodeIds: [nodeTransition.id],
};

export const branchWithheld: Branch = {
  id: 'br_withheld',
  nodeId: nodeAdr.id,
  label: 'Event-sourced ledger (proposed after the decision)',
  taken: false,
  evidence: [
    ev('cmt-late', 'confluence-comment', '2026-07-01T09:00:00.000Z', {
      independenceKey: 'author-dan',
    }),
    ev('build-91', 'external-build', '2026-09-28T09:00:00.000Z', {
      independenceKey: 'component-ledger',
      implementationProof: true,
      outcome: 'passed',
    }),
  ],
  downstreamNodeIds: [],
  requiredDependencies: [],
  // Replacing the ledger means unwinding both the schema decision and the
  // transition that closed the spike — the most expensive branch in the tree.
  unwindsNodeIds: [nodeTransition.id, nodeAdr.id],
};

export const branches: Branch[] = [branchTaken, branchShard, branchWithheld];
