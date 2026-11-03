import type { Iso } from '../shared/types';
import type { TimelineBranch, TimelineNode } from './timeline';

/**
 * The tree as it looked at a moment.
 *
 * `treeAt(T)` answers the question the product exists to answer: on this date,
 * which decisions had already been made, which paths were still open, and which
 * evidence had not happened yet. Nothing is inferred — a node is present only if
 * it was decided by T, and a branch is present only if its evidence existed by T.
 */

export interface TreeSnapshot {
  asOf: Iso;
  /** Decisions already made at T. */
  decided: TimelineNode[];
  /** Branches whose evidence existed at T. */
  branches: TimelineBranch[];
  /** Branches attached to decisions not yet made at T — the paths still open. */
  openBranches: TimelineBranch[];
  /** Evidence dated after T: invisible to the people deciding. */
  futureEvidenceAris: string[];
}

function at(iso: string | undefined | null): number {
  const parsed = Date.parse(iso ?? '');
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function treeAt(
  input: { nodes: readonly TimelineNode[]; branches: readonly TimelineBranch[] },
  asOf: Iso,
): TreeSnapshot {
  const cutoff = at(asOf);

  const decided = input.nodes.filter((node) => at(node.decidedAt) <= cutoff);
  const undecidedNodeIds = new Set(
    input.nodes.filter((node) => at(node.decidedAt) > cutoff).map((node) => node.id),
  );

  const branches: TimelineBranch[] = [];
  const openBranches: TimelineBranch[] = [];
  const futureEvidenceAris: string[] = [];

  for (const branch of input.branches) {
    const evidence = branch.evidence ?? [];
    const evidenceExists = evidence.every((item) => at(item.createdAt) <= cutoff);

    if (!evidenceExists) {
      futureEvidenceAris.push(...evidence.filter((item) => at(item.createdAt) > cutoff).map((item) => item.ari));
    }

    if (undecidedNodeIds.has(branch.nodeId)) {
      openBranches.push(branch);
      continue;
    }

    if (evidenceExists) branches.push(branch);
  }

  return {
    asOf,
    decided,
    branches,
    openBranches,
    futureEvidenceAris: [...new Set(futureEvidenceAris)],
  };
}

/**
 * Plain-language statement of the snapshot, for a card or a tool response.
 * Reports what was open and what could not yet be known — never a prediction.
 */
export function describeTree(snapshot: TreeSnapshot): string {
  const decided = snapshot.decided.length;
  const open = snapshot.openBranches.length;
  const hidden = snapshot.futureEvidenceAris.length;

  if (decided === 0) {
    return `As of ${snapshot.asOf}: no decision had been made yet; ${open} path(s) still open.`;
  }

  const hiddenClause =
    hidden === 0
      ? 'every piece of evidence used to judge it was already available'
      : `${hidden} piece(s) of evidence used to judge it did not exist yet`;

  return `As of ${snapshot.asOf}: ${decided} decision(s) made, ${open} path(s) still open, and ${hiddenClause}.`;
}
