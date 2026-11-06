import type { BranchViewDto, RunSnapshotDto, TreeNodeDto } from '../shared/dtos';

/**
 * Tree projection.
 *
 * The tree is not stored — it is computed from the decision index, anchored
 * wherever you ask and filtered by what was knowable at that moment. That
 * distinction is the whole product:
 *
 *   a stored tree answers "what do we know now about this?"
 *   a projected tree answers "what could we have known when we decided?"
 *
 * Every projection carries `invisibleAfter`: the evidence that did not exist at
 * the anchor. Without it the agent would imply negligence where the team simply
 * could not have known.
 */

export type Direction = 'backward' | 'forward';

export interface ProjectedNode {
  id: string;
  title: string;
  kind: string;
  decidedAt: string;
  /** Visible at the anchor, i.e. the decision existed by `asOf`. */
  inForce: boolean;
  /** Alternatives that existed at the anchor. */
  visibleAlternatives: Array<{ id: string; label: string; taken: boolean; gap: number }>;
  /** Alternatives whose evidence postdates the anchor — not knowable then. */
  hiddenAlternatives: Array<{ id: string; label: string; evidenceAfter: string }>;
}

export interface ProjectedEdge {
  from: string;
  to: string;
  kind: 'preceded' | 'superseded' | 'constrained';
}

export interface TreeProjection {
  anchor: {
    runId: string;
    workItemKey: string;
    asOf: string;
    direction: Direction;
  };
  nodes: ProjectedNode[];
  edges: ProjectedEdge[];
  /** Timestamps after the anchor: what the people involved could not have seen. */
  invisibleAfter: string | null;
  counts: { nodes: number; visibleAlternatives: number; hiddenAlternatives: number };
  /** Plain statement for a card or a tool response. */
  summary: string;
}

export interface ProjectionInput {
  snapshot: RunSnapshotDto;
  asOf?: string;
  direction?: Direction;
  depth?: number;
}

function at(iso: string | undefined | null): number {
  const parsed = Date.parse(iso ?? '');
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function clampDepth(depth: number | undefined, total: number): number {
  if (!Number.isFinite(depth) || (depth ?? 0) <= 0) return total;
  return Math.max(1, Math.min(Math.floor(depth as number), total));
}

/**
 * Projects the decision tree the way it looked at `asOf`.
 *
 * `backward` walks from the anchor towards the decisions that preceded it —
 * "how did we get here". `forward` walks towards what the decisions still
 * constrain — "what does this bind now".
 */
export function projectTree(input: ProjectionInput): TreeProjection {
  const { snapshot } = input;
  const asOf = input.asOf && Number.isFinite(at(input.asOf)) ? input.asOf : snapshot.event.at;
  const direction: Direction = input.direction === 'forward' ? 'forward' : 'backward';
  const cutoff = at(asOf);

  const ordered = [...snapshot.nodes].sort((a, b) => at(a.decidedAt) - at(b.decidedAt));

  // Backward: everything decided at or before the anchor, newest first.
  const candidates = ordered.filter((node) => at(node.decidedAt) <= cutoff);
  const sliced =
    direction === 'backward' ? candidates.slice(-clampDepth(input.depth, candidates.length)) : candidates;

  const branchesByNode = new Map<string, BranchViewDto[]>();
  for (const branch of snapshot.branches) {
    const list = branchesByNode.get(branch.nodeId) ?? [];
    list.push(branch);
    branchesByNode.set(branch.nodeId, list);
  }

  const nodes: ProjectedNode[] = sliced.map((node: TreeNodeDto) => {
    const branches = branchesByNode.get(node.id) ?? [];
    const visible: ProjectedNode['visibleAlternatives'] = [];
    const hidden: ProjectedNode['hiddenAlternatives'] = [];

    for (const branch of branches) {
      // A branch is knowable at the anchor only if ^the evidence behind it existed.
      const evidenceAt = branch.evidenceAt ?? [];
      const latest = evidenceAt.length > 0 ? evidenceAt[evidenceAt.length - 1] : null;
      const exists = latest ? at(latest) <= cutoff : true;

      if (exists) {
        visible.push({
          id: branch.id,
          label: branch.label,
          taken: branch.taken,
          gap: branch.score?.gap ?? 0,
        });
      } else {
        hidden.push({ id: branch.id, label: branch.label, evidenceAfter: latest ?? asOf });
      }
    }

    return {
      id: node.id,
      title: node.title,
      kind: node.kind,
      decidedAt: node.decidedAt,
      inForce: true,
      visibleAlternatives: visible,
      hiddenAlternatives: hidden,
    };
  });

  const edges: ProjectedEdge[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    edges.push({ from: nodes[index - 1]!.id, to: nodes[index]!.id, kind: 'preceded' });
  }

  // Forward direction: what each decision still constrains, taken from the
  // declared downstream links rather than inferred.
  if (direction === 'forward') {
    for (const branch of snapshot.branches) {
      for (const downstream of branch.downstreamNodeIds ?? []) {
        if (nodes.some((n) => n.id === branch.nodeId) && nodes.some((n) => n.id === downstream)) {
          edges.push({ from: branch.nodeId, to: downstream, kind: 'constrained' });
        }
      }
      for (const unwound of branch.unwindsNodeIds ?? []) {
        if (nodes.some((n) => n.id === branch.nodeId) && nodes.some((n) => n.id === unwound)) {
          edges.push({ from: branch.nodeId, to: unwound, kind: 'superseded' });
        }
      }
    }
  }

  const hiddenCount = nodes.reduce((total, node) => total + node.hiddenAlternatives.length, 0);
  const visibleCount = nodes.reduce((total, node) => total + node.visibleAlternatives.length, 0);
  const latestHidden = nodes
    .flatMap((node) => node.hiddenAlternatives.map((alt) => alt.evidenceAfter))
    .sort((a, b) => at(a) - at(b))
    .at(0);

  const summary =
    nodes.length === 0
      ? `As of ${asOf}, no decision had been made: everything was still open.`
      : `As of ${asOf}: ${nodes.length} decision(s) in force, ${visibleCount} alternative(s) visible, ${hiddenCount} not yet knowable.`;

  return {
    anchor: { runId: snapshot.runId, workItemKey: snapshot.workItemKey, asOf, direction },
    nodes,
    edges,
    invisibleAfter: latestHidden ?? null,
    counts: { nodes: nodes.length, visibleAlternatives: visibleCount, hiddenAlternatives: hiddenCount },
    summary,
  };
}
