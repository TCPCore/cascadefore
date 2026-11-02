import type {
  ArithmeticStep,
  Branch,
  BranchScore,
  DecisionNode,
  Evidence,
} from '../shared/types';
import { OUTCOME_FACTOR } from './constants';
import { clamp01, round, sum } from './math';
import { recencyWeight, splitByKnowability } from './timeGate';

/**
 * Independence discount.
 *
 * Four comments from the same author are not four independent facts. Counting
 * each key once with a 1/√n discount keeps corroboration from being farmed by
 * a single enthusiastic reviewer.
 */
export function independenceDiscounts(evidenceSet: readonly Evidence[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of evidenceSet) {
    counts.set(e.independenceKey, (counts.get(e.independenceKey) ?? 0) + 1);
  }
  const discounts = new Map<string, number>();
  for (const [key, count] of counts) {
    discounts.set(key, 1 / Math.sqrt(count));
  }
  return discounts;
}

function contributionForKnowability(
  evidence: Evidence,
  decidedAt: string,
  discounts: Map<string, number>,
): number {
  const recency = recencyWeight(evidence.createdAt, decidedAt);
  const discount = discounts.get(evidence.independenceKey) ?? 1;
  return evidence.sourceAuthority * recency * discount;
}

function contributionForViability(evidence: Evidence, discounts: Map<string, number>): number {
  const field = evidence.implementationProof ? 1 : evidence.sourceAuthority * 0.5;
  const outcome = OUTCOME_FACTOR[evidence.outcome];
  const discount = discounts.get(evidence.independenceKey) ?? 1;
  return field * outcome * discount;
}

function formatList(values: readonly number[], max = 3): string {
  const shown = values.slice(0, max).map((v) => round(v, 2).toFixed(2));
  return values.length > max ? `${shown.join(' + ')} + …` : shown.join(' + ');
}

/**
 * Scores one branch on two axes that are deliberately computed the same way:
 *
 *   W_k  what the team could reasonably have known, at the time
 *   W_v  what proved viable, judging by everything since
 *
 * `gap` is the product. A high gap means the information existed inside the
 * organisation and was never connected to the decision.
 */
export function scoreBranch(
  branch: Branch,
  node: DecisionNode,
  runEvidence: readonly Evidence[] = branch.evidence,
): BranchScore {
  const { knowable, withheld } = splitByKnowability(branch.evidence, node.decidedAt);
  const discounts = independenceDiscounts(runEvidence.length > 0 ? runEvidence : branch.evidence);

  const knowabilityContributions = knowable.map((e) =>
    contributionForKnowability(e, node.decidedAt, discounts),
  );
  const viabilityContributions = branch.evidence.map((e) =>
    contributionForViability(e, discounts),
  );

  const knowability = clamp01(sum(knowabilityContributions));
  const viability = clamp01(sum(viabilityContributions));
  const gap = round(viability - knowability, 4);

  const recencies = knowable.map((e) => recencyWeight(e.createdAt, node.decidedAt));
  const avgRecency = recencies.length > 0 ? sum(recencies) / recencies.length : 0;
  const avgDiscount =
    knowable.length > 0
      ? sum(knowable.map((e) => discounts.get(e.independenceKey) ?? 1)) / knowable.length
      : 0;

  const proofCount = branch.evidence.filter((e) => e.implementationProof).length;
  const passed = branch.evidence.filter((e) => e.outcome === 'passed').length;
  const failed = branch.evidence.filter((e) => e.outcome === 'failed').length;

  const arithmetic: ArithmeticStep[] = [
    {
      label: 'Knowable at the time',
      expression: `${knowable.length} of ${branch.evidence.length} objects predate ${node.decidedAt.slice(0, 10)}`,
      value: knowable.length,
    },
    {
      label: 'Authority Σ',
      expression: formatList(knowable.map((e) => e.sourceAuthority)),
      value: round(sum(knowable.map((e) => e.sourceAuthority)), 4),
    },
    {
      label: 'Recency (avg)',
      expression: knowable.length > 0 ? `avg of ${knowable.length} decays` : 'no knowable evidence',
      value: round(avgRecency, 4),
    },
    {
      label: 'Independence (avg)',
      expression: `1/√n per key, ${new Set(branch.evidence.map((e) => e.independenceKey)).size} keys`,
      value: round(avgDiscount, 4),
    },
    { label: 'W_k', expression: 'clamp01(Σ authority × recency × independence)', value: knowability },
    {
      label: 'Implementation proof',
      expression: `${proofCount} object(s) built or deployed elsewhere`,
      value: proofCount,
    },
    {
      label: 'Outcome signal',
      expression: `${passed} passed · ${failed} failed · ${branch.evidence.length - passed - failed} unknown`,
      value: passed,
    },
    { label: 'W_v', expression: 'clamp01(Σ proof × outcome × independence)', value: viability },
    { label: 'Gap', expression: 'W_v − W_k', value: gap },
  ];

  return {
    branchId: branch.id,
    knowability: round(knowability, 4),
    viability: round(viability, 4),
    gap,
    confidence: round(Math.min(knowability, viability), 4),
    knowableEvidenceAris: knowable.map((e) => e.ari),
    withheldEvidenceAris: withheld.map((e) => e.ari),
    arithmetic,
  };
}

export function scoreBranches(
  nodes: readonly DecisionNode[],
  branches: readonly Branch[],
): BranchScore[] {
  const runEvidence = branches.flatMap((b) => b.evidence);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: BranchScore[] = [];
  for (const branch of branches) {
    const node = byId.get(branch.nodeId);
    if (!node) continue; // orphan branches are dropped, never rendered
    out.push(scoreBranch(branch, node, runEvidence));
  }
  return out;
}
