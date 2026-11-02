import type {
  Branch,
  DecisionKind,
  DecisionNode,
  Evidence,
  EvidenceType,
  Iso,
  SpineSegment,
} from '../shared/types.js';
import { MAX_BRANCHES_PER_NODE, MAX_SPINE_DEPTH, IMPLICIT_CONFIDENCE_CAP, AUTHORITY } from '../domain/constants.js';
import { stableId } from '../shared/ids.js';

/**
 * Raw artifact as delivered by the graph layer. Deliberately decoupled from
 * Cypher result shapes so a relationship rename never reaches this file.
 */
export interface RawArtifact {
  ari: string;
  type: EvidenceType;
  title: string;
  createdAt: Iso;
  updatedAt?: Iso;
  authorAri?: string;
  bodyText?: string;
  componentAri?: string;
  replyCount?: number;
  implementationProof?: boolean;
  outcome?: 'passed' | 'failed' | 'unknown';
  webUrl?: string;
  areaKey?: string;
  /** Number of graph objects that depend on this decision (feeds migration cost). */
  dependentCount?: number;
}

export const ADR_TITLE = /\b(adr|decision record|rfc|design doc|architecture decision)\b/i;
export const ADR_BODY = /\b(options considered|alternatives considered|decision outcome|consequences)\b/i;
export const RESOLUTION_MARKER = /\b(we(?:'| a)ll go with|decided|closing as|agreed to|let'?s go with|locking this in)\b/i;

export interface Classification {
  kind: DecisionKind;
  confidence: number;
  reason: string;
}

/**
 * Decision synthesis rules.
 *
 * Teamwork Graph has no `Decision` object, so a decision is inferred from the
 * shape of the artefact that recorded it. Every rule is explicit, ordered, and
 * returns a human-readable reason so the UI can explain *why* a node exists.
 */
export function classifyArtifact(artifact: RawArtifact): Classification | null {
  const body = artifact.bodyText ?? '';
  const titleIsAdr = ADR_TITLE.test(artifact.title);
  const bodyIsAdr = ADR_BODY.test(body);
  const resolved = RESOLUTION_MARKER.test(body);

  switch (artifact.type) {
    case 'confluence-page':
      if (titleIsAdr && bodyIsAdr) {
        return { kind: 'documented', confidence: 0.9, reason: 'ADR title and options-considered section' };
      }
      if (titleIsAdr) {
        return { kind: 'documented', confidence: 0.75, reason: 'ADR-style title' };
      }
      if (bodyIsAdr) {
        return { kind: 'documented', confidence: 0.7, reason: 'Options-considered section without ADR title' };
      }
      return null;

    case 'confluence-comment': {
      const replies = artifact.replyCount ?? 0;
      if (replies >= 3 && resolved) {
        return {
          kind: 'thread',
          confidence: Math.min(0.6 + 0.05 * Math.min(replies, 4), 0.8),
          reason: `Resolved thread with ${replies} replies`,
        };
      }
      if (replies >= 3) {
        return { kind: 'thread', confidence: 0.55, reason: `Unresolved thread with ${replies} replies` };
      }
      return null;
    }

    case 'jira-comment':
      return resolved ? { kind: 'thread', confidence: 0.5, reason: 'Resolution marker in issue comment' } : null;

    case 'jira-status':
      return { kind: 'transition', confidence: 0.5, reason: 'Workflow transition closed the question' };

    default:
      // Builds, deployments, PRs and goals are evidence, never decisions.
      return null;
  }
}

export function toEvidence(artifact: RawArtifact): Evidence {
  return {
    ari: artifact.ari,
    type: artifact.type,
    createdAt: artifact.createdAt,
    ...(artifact.updatedAt ? { lastUpdated: artifact.updatedAt } : {}),
    title: artifact.title,
    sourceAuthority: AUTHORITY[artifact.type],
    independenceKey: artifact.authorAri ?? artifact.componentAri ?? artifact.ari,
    implementationProof: artifact.implementationProof ?? false,
    outcome: artifact.outcome ?? 'unknown',
  };
}

export function areaOf(artifact: RawArtifact): string {
  return artifact.areaKey ?? artifact.componentAri ?? 'area:unknown';
}

export function toDecisionNode(artifact: RawArtifact, classification: Classification): DecisionNode {
  return {
    id: stableId('node', classification.kind, artifact.ari),
    ari: artifact.ari,
    kind: classification.kind,
    title: artifact.title,
    decidedAt: artifact.createdAt,
    actorAris: artifact.authorAri ? [artifact.authorAri] : [],
    confidence: classification.kind === 'implicit'
      ? Math.min(classification.confidence, IMPLICIT_CONFIDENCE_CAP)
      : classification.confidence,
    evidence: [toEvidence(artifact)],
  };
}

export interface Assembly {
  nodes: DecisionNode[];
  spine: SpineSegment[];
  branches: Branch[];
}

/**
 * Builds the spine (closest decision first) and one branch per evidenced
 * alternative. Choosing a different option at an earlier decision invalidates
 * every later decision on the spine — those are the segments to unwind.
 */
export function assemble(artifacts: readonly RawArtifact[], failureAt: Iso): Assembly {
  const decisions: Array<{ artifact: RawArtifact; classification: Classification }> = [];

  for (const artifact of artifacts) {
    const classification = classifyArtifact(artifact);
    if (classification) decisions.push({ artifact, classification });
  }

  decisions.sort((a, b) => Date.parse(b.artifact.createdAt) - Date.parse(a.artifact.createdAt));

  const capped = decisions.slice(0, MAX_SPINE_DEPTH);
  const nodes = capped.map((d) => toDecisionNode(d.artifact, d.classification));

  const spine: SpineSegment[] = capped.map((d, index) => ({
    nodeId: nodes[index]!.id,
    ari: d.artifact.ari,
    title: d.artifact.title,
    order: index,
    dependentCount: d.artifact.dependentCount ?? 0,
    resolved: d.artifact.outcome === 'passed',
  }));

  const byArea = new Map<string, Array<{ artifact: RawArtifact; node: DecisionNode; order: number }>>();
  capped.forEach((d, index) => {
    const area = areaOf(d.artifact);
    const node = nodes[index]!;
    const entry = byArea.get(area) ?? [];
    entry.push({ artifact: d.artifact, node, order: index });
    byArea.set(area, entry);
  });

  const branches: Branch[] = [];
  const areaByBranchId = new Map<string, string>();
  const alternativesByArea = new Map<string, Branch[]>();

  for (const [area, entries] of byArea) {
    const first = entries[0];
    if (!first) continue;

    // The earliest recorded decision in an area is the taken path.
    const taken: Branch = {
      id: stableId('br', 'taken', first.node.id),
      nodeId: first.node.id,
      label: first.artifact.title,
      taken: true,
      evidence: [toEvidence(first.artifact)],
      downstreamNodeIds: entries.slice(1).map((e) => e.node.id),
      requiredDependencies: first.artifact.componentAri ? [first.artifact.componentAri] : [],
      unwindsNodeIds: [],
    };
    branches.push(taken);
    areaByBranchId.set(taken.id, area);

    const alternatives = entries.slice(1, 1 + MAX_BRANCHES_PER_NODE);
    for (const alt of alternatives) {
      const branch: Branch = {
        id: stableId('br', 'alt', alt.node.id),
        nodeId: alt.node.id,
        label: alt.artifact.title,
        taken: false,
        evidence: [toEvidence(alt.artifact)],
        downstreamNodeIds: [],
        requiredDependencies: alt.artifact.componentAri ? [alt.artifact.componentAri] : [],
        unwindsNodeIds: spine.filter((s) => s.order < alt.order).map((s) => s.nodeId),
      };
      branches.push(branch);
      areaByBranchId.set(branch.id, area);
      const list = alternativesByArea.get(area) ?? [];
      list.push(branch);
      alternativesByArea.set(area, list);
    }
  }

  // Outcomes are evidence, never decisions: a build that passed on an
  // alternative path is the strongest available proof that the path was viable.
  const outcomeArtifacts = artifacts.filter(
    (a) => a.type === 'external-build' || a.type === 'external-deployment' || a.type === 'external-pull-request',
  );

  for (const outcome of outcomeArtifacts) {
    const area = areaOf(outcome);
    const targets = alternativesByArea.get(area) ?? [];
    for (const branch of targets) {
      branch.evidence.push(toEvidence(outcome));
    }
  }

  return { nodes, spine, branches };
}

/**
 * Synthesises an `implicit` node where a sibling component documented a
 * decision and this one did not. This is the highest-value finding the product
 * produces: the silent, unrecorded choice.
 */
export function synthesizeImplicitNode(
  componentAri: string,
  anchor: RawArtifact,
  missingTitle: string,
): DecisionNode | null {
  if (!componentAri || !anchor.createdAt) return null;
  const ari = `implicit://${componentAri}/${stableId('imp', anchor.ari)}`;
  return {
    id: stableId('node', 'implicit', ari),
    ari,
    kind: 'implicit',
    title: missingTitle,
    decidedAt: anchor.createdAt,
    actorAris: [],
    confidence: Math.min(0.8, IMPLICIT_CONFIDENCE_CAP),
    evidence: [toEvidence({ ...anchor, ari, type: 'confluence-page' })],
  };
}
