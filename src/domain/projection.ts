import type {
  Ari,
  Branch,
  BranchScore,
  DecisionNode,
  Iso,
  SpineSegment,
} from '../shared/types';
import { round } from './math';

/**
 * What actually happens if a branch is taken.
 *
 * This is the one place the product could slide into speculation, so it is
 * built out of two strictly separated halves:
 *
 *  1. **Observed precedent** — where this exact alternative was already built,
 *     deployed or shipped, and what happened. Evidence only.
 *  2. **Structural consequence** — which downstream decisions the alternative
 *     invalidates, and how much depends on them. Arithmetic only.
 *
 * An alternative with no precedent is reported as *unevidenced*, never as a
 * predicted outcome.
 */
export interface Projection {
  headline: string;
  /** true only when implementation proof exists somewhere in the graph. */
  evidenced: boolean;
  observedOutcome: 'passed' | 'failed' | 'unknown';
  precedentAris: Ari[];
  invalidates: string[];
  retains: string[];
  dependentObjects: number;
  confidence: number;
  timeline: Array<{ at: Iso; label: string; ari: Ari | null }>;
}

function labelFor(evidence: { title: string; type: string; outcome: string }): string {
  const suffix = evidence.outcome === 'passed' ? 'passed' : evidence.outcome === 'failed' ? 'failed' : 'recorded';
  return `${evidence.type.replace(/-/g, ' ')} ${suffix}: ${evidence.title}`.slice(0, 140);
}

export function projectBranch(
  branch: Branch,
  node: DecisionNode,
  spine: readonly SpineSegment[],
  score: BranchScore,
): Projection {
  const precedent = branch.evidence.filter((e) => e.implementationProof);
  const failures = branch.evidence.filter((e) => e.outcome === 'failed');

  const observedOutcome: Projection['observedOutcome'] =
    precedent.some((e) => e.outcome === 'passed')
      ? 'passed'
      : failures.length > 0
        ? 'failed'
        : 'unknown';

  const invalidates = [...branch.unwindsNodeIds];
  const retained = spine.filter((s) => !invalidates.includes(s.nodeId));
  const dependentObjects = spine
    .filter((s) => invalidates.includes(s.nodeId))
    .reduce((total, segment) => total + segment.dependentCount, 0);

  const evidenced = precedent.length > 0 || observedOutcome !== 'unknown';

  const headline = !evidenced
    ? 'No precedent in the graph — structural consequence only'
    : observedOutcome === 'passed'
      ? `Proven elsewhere: ${precedent.length} build/deploy artefact(s) succeeded on this path`
      : observedOutcome === 'failed'
        ? 'Attempted elsewhere and failed'
        : 'Attempted elsewhere, outcome not recorded';

  const timeline = [...branch.evidence]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((e) => ({
      at: e.createdAt,
      label: labelFor(e),
      ari: e.ari,
    }));

  return {
    headline,
    evidenced,
    observedOutcome,
    precedentAris: precedent.map((e) => e.ari),
    invalidates,
    retains: retained.map((s) => s.nodeId),
    dependentObjects,
    confidence: round(score.confidence, 4),
    timeline,
  };
}

/**
 * A readable forward description of the world after the branch is taken:
 * what survives, what is undone, and what it costs.
 */
export function describeConsequence(
  branch: Branch,
  spine: readonly SpineSegment[],
  titles: Readonly<Record<string, string>>,
): string[] {
  const unwound = spine.filter((s) => branch.unwindsNodeIds.includes(s.nodeId));
  const kept = spine.filter((s) => !branch.unwindsNodeIds.includes(s.nodeId));

  const lines: string[] = [];
  lines.push(
    unwound.length === 0
      ? 'No downstream decision is contradicted; the spine survives intact.'
      : `Undoes ${unwound.length} downstream decision(s): ${unwound
          .map((s) => titles[s.nodeId] ?? s.title)
          .join(' → ')}.`,
  );
  lines.push(
    kept.length === 0
      ? 'Nothing upstream of the divergence survives.'
      : `Keeps ${kept.length} decision(s) upstream of the divergence.`,
  );
  const cost = unwound.reduce((n, s) => n + s.dependentCount, 0);
  lines.push(
    cost === 0
      ? 'No dependent objects recorded against the undone decisions.'
      : `${cost} dependent object(s) would need to move with them.`,
  );
  return lines;
}
