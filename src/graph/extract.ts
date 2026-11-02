import type {
  Branch,
  DecisionKind,
  DecisionNode,
  Evidence,
  EvidenceType,
  Iso,
  SpineSegment,
} from '../shared/types';
import { MAX_BRANCHES_PER_NODE, MAX_SPINE_DEPTH, IMPLICIT_CONFIDENCE_CAP, AUTHORITY } from '../domain/constants';
import { stableId } from '../shared/ids';

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
/**
 * Resolution markers.
 *
 * Real threads resolve in prose: "Yes, for now", "approved", "signing off".
 * The first version only matched formal phrasing ("decided", "agreed to"), so a
 * genuine resolution in plain speech was missed and the *first* comment was
 * mistaken for the decision — plausible output, silently wrong.
 */
export const RESOLUTION_MARKER =
  /\b(we(?:'| a)ll go with|decided|closing as|agreed to|let'?s go with|locking this in|approved|sign(?:ed|ing)? off|yes,? for now|yes[,.]? (?:let'?s|we)|go ahead|ship it)\b/i;

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

/**
 * Thread clustering.
 *
 * Every reply on a page shares the same subject line, so treating each comment
 * as its own decision produces three identical-looking nodes — a comment viewer
 * with a scoring function, not a decision reconstructor.
 *
 * A thread is one decision: the page provides the subject, the comments provide
 * the positions, and the comment carrying a resolution marker is the branch that
 * was taken. Distinctness of the resulting labels is asserted by a test, because
 * "three identical branches" is exactly the kind of plausible-looking output
 * that hides a modelling error.
 */
export interface ThreadCluster {
  area: string;
  page: RawArtifact | null;
  comments: RawArtifact[];
}

export function clusterThreads(artifacts: readonly RawArtifact[]): ThreadCluster[] {
  const byArea = new Map<string, ThreadCluster>();

  for (const artifact of artifacts) {
    const isComment = artifact.type === 'confluence-comment' || artifact.type === 'jira-comment';
    const isPage = artifact.type === 'confluence-page';
    if (!isComment && !isPage) continue;

    const area = areaOf(artifact);
    const cluster = byArea.get(area) ?? { area, page: null, comments: [] };

    if (isPage && !cluster.page) cluster.page = artifact;
    if (isComment) cluster.comments.push(artifact);

    byArea.set(area, cluster);
  }

  return [...byArea.values()].filter((cluster) => cluster.comments.length > 0);
}

function latestIso(values: readonly string[]): Iso {
  return values.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest), values[0]!);
}

export interface ThreadDecision {
  node: DecisionNode;
  branches: Branch[];
}

export function buildThreadDecision(cluster: ThreadCluster): ThreadDecision | null {
  if (cluster.comments.length === 0) return null;

  const ordered = [...cluster.comments].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );

  const resolution = ordered.filter((c) => RESOLUTION_MARKER.test(c.bodyText ?? '')).at(-1);
  const decidedAt = latestIso(ordered.map((c) => c.createdAt));
  const title = cluster.page?.title ?? `Discussion in ${cluster.area}`;

  const nodeId = stableId('node', 'thread', cluster.area);
  const evidence = [...(cluster.page ? [toEvidence(cluster.page)] : []), ...ordered.map(toEvidence)];

  const confidence = Math.min(
    0.6 + 0.05 * Math.min(ordered.length, 4) + (resolution ? 0.05 : 0),
    0.85,
  );

  const node: DecisionNode = {
    id: nodeId,
    ari: cluster.page?.ari ?? ordered[0]!.ari,
    kind: 'thread',
    title,
    decidedAt,
    actorAris: ordered.map((c) => c.authorAri).filter((a): a is string => Boolean(a)),
    confidence,
    evidence,
  };

  const branches: Branch[] = ordered.map((comment, index) => {
    const isResolution = resolution?.ari === comment.ari;
    return {
      id: stableId('br', 'position', comment.ari),
      nodeId,
      label: (comment.bodyText ?? comment.title).trim().slice(0, 90) || `position ${index + 1}`,
      taken: isResolution,
      evidence: [toEvidence(comment)],
      downstreamNodeIds: [],
      requiredDependencies: [],
      unwindsNodeIds: [],
    };
  });

  // A thread with no resolution marker is still a decision — nobody just recorded
  // the outcome. The first position is treated as the one in force.
  if (!resolution && branches.length > 0) branches[0]!.taken = true;

  return { node, branches };
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
  const clusters = clusterThreads(artifacts);
  const commentAris = new Set(clusters.flatMap((cluster) => cluster.comments.map((c) => c.ari)));

  // Documented decisions, excluding comments: a comment is a position inside a
  // decision, not a decision of its own.
  const documented: Array<{ artifact: RawArtifact; classification: Classification }> = [];
  for (const artifact of artifacts) {
    if (commentAris.has(artifact.ari)) continue;
    const classification = classifyArtifact(artifact);
    if (classification) documented.push({ artifact, classification });
  }

  const threadDecisions = clusters
    .map(buildThreadDecision)
    .filter((value): value is ThreadDecision => value !== null);

  interface Entry {
    node: DecisionNode;
    artifact: RawArtifact | null;
    thread: ThreadDecision | null;
  }

  const entries: Entry[] = [
    ...documented.map((d) => ({
      node: toDecisionNode(d.artifact, d.classification),
      artifact: d.artifact,
      thread: null,
    })),
    ...threadDecisions.map((t) => ({ node: t.node, artifact: null, thread: t })),
  ];

  entries.sort((a, b) => Date.parse(b.node.decidedAt) - Date.parse(a.node.decidedAt));
  const capped = entries.slice(0, MAX_SPINE_DEPTH);

  const nodes = capped.map((entry) => entry.node);
  const spine: SpineSegment[] = capped.map((entry, index) => ({
    nodeId: entry.node.id,
    ari: entry.node.ari,
    title: entry.node.title,
    order: index,
    dependentCount:
      entry.artifact?.dependentCount ??
      entry.thread?.node.evidence.filter((e) => e.type === 'confluence-comment').length ??
      0,
    resolved: entry.artifact?.outcome === 'passed',
  }));

  const branches: Branch[] = [];
  const areaByBranchId = new Map<string, string>();
  const alternativesByArea = new Map<string, Branch[]>();

  // Documented decisions keep the taken/alternative treatment per area.
  const documentedByArea = new Map<
    string,
    Array<{ artifact: RawArtifact; node: DecisionNode; order: number }>
  >();

  capped.forEach((entry, index) => {
    if (!entry.artifact) return;
    const area = areaOf(entry.artifact);
    const list = documentedByArea.get(area) ?? [];
    list.push({ artifact: entry.artifact, node: entry.node, order: index });
    documentedByArea.set(area, list);
  });

  for (const [area, list] of documentedByArea) {
    const first = list[0];
    if (!first) continue;

    const taken: Branch = {
      id: stableId('br', 'taken', first.node.id),
      nodeId: first.node.id,
      label: first.artifact.title,
      taken: true,
      evidence: [toEvidence(first.artifact)],
      downstreamNodeIds: list.slice(1).map((e) => e.node.id),
      requiredDependencies: first.artifact.componentAri ? [first.artifact.componentAri] : [],
      unwindsNodeIds: [],
    };
    branches.push(taken);
    areaByBranchId.set(taken.id, area);

    for (const alt of list.slice(1, 1 + MAX_BRANCHES_PER_NODE)) {
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
      const bucket = alternativesByArea.get(area) ?? [];
      bucket.push(branch);
      alternativesByArea.set(area, bucket);
    }
  }

  // Thread decisions carry their positions as branches.
  for (const entry of capped) {
    if (!entry.thread) continue;
    branches.push(...entry.thread.branches);
  }

  const outcomeArtifacts = artifacts.filter(
    (a) => a.type === 'external-build' || a.type === 'external-deployment' || a.type === 'external-pull-request',
  );

  for (const outcome of outcomeArtifacts) {
    const area = areaOf(outcome);
    for (const branch of alternativesByArea.get(area) ?? []) {
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
