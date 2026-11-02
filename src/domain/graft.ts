import type {
  ArithmeticStep,
  Branch,
  BranchScore,
  DecisionNode,
  Graft,
  Intent,
  Iso,
  PathCandidate,
  PathFacts,
  Recommendation,
  SpineSegment,
} from '../shared/types.js';
import {
  MIGRATION_NORMALISER,
  RESIDUAL_NORMALISER,
} from './constants.js';
import { detectConstraintTags, intentFit, type ConstraintTag } from './intent.js';
import { clamp01, round, sum } from './math.js';
import { isSuperseded } from './timeGate.js';

export interface RankOptions {
  now: Iso;
  /** A dependency is walkable today if this returns true. Defaults to always. */
  dependencyAlive?: (ari: string) => boolean;
}

interface RawFacts {
  migrationRaw: number;
  residualRaw: number;
  applicability: number;
  freshness: number;
}

export function computeRawFacts(
  branch: Branch,
  spine: readonly SpineSegment[],
  now: Iso,
  dependencyAlive: (ari: string) => boolean,
): RawFacts {
  const unwound = spine.filter((s) => branch.unwindsNodeIds.includes(s.nodeId));
  const unwoundIds = new Set(unwound.map((s) => s.nodeId));

  const migrationRaw = sum(unwound.map((s) => s.dependentCount));
  const residualRaw = spine.filter((s) => !unwoundIds.has(s.nodeId) && !s.resolved).length;

  const deps = branch.requiredDependencies;
  const applicability = deps.length === 0 ? 1 : deps.filter(dependencyAlive).length / deps.length;

  const freshness =
    branch.evidence.length === 0
      ? 0
      : branch.evidence.filter((e) => !isSuperseded(e, now)).length / branch.evidence.length;

  return { migrationRaw, residualRaw, applicability, freshness };
}

export function computeFacts(raw: RawFacts, intent: Intent): PathFacts {
  const migrationCost = clamp01(raw.migrationRaw / MIGRATION_NORMALISER);
  const residualRisk = clamp01(raw.residualRaw / RESIDUAL_NORMALISER);
  const fit = intentFit(intent, {
    migrationCost,
    residualRisk,
    freshness: raw.freshness,
  });
  return {
    migrationCost,
    residualRisk,
    applicability: raw.applicability,
    freshness: raw.freshness,
    intentFit: fit.value,
  };
}

/**
 * Hard-constraint vetoes. Only tagged constraints veto; an untagged constraint
 * is reported back to the caller as unmapped rather than guessed at.
 */
export function evaluateVeto(
  intent: Intent,
  branch: Branch,
  facts: PathFacts,
): { vetoed: boolean; reason?: string } {
  const tags = detectConstraintTags(intent.hardConstraints);
  const hit = (tag: ConstraintTag): boolean => tags.includes(tag);

  if (hit('no-new-dependency') && facts.applicability < 1) {
    return { vetoed: true, reason: 'Requires a dependency that is no longer resolvable' };
  }
  if (hit('ship-within-2-weeks') && facts.migrationCost > 0.5) {
    return { vetoed: true, reason: 'Migration cost exceeds a two-week window' };
  }
  if (hit('no-schema-change') && /schema|migration|column|table/i.test(branch.label)) {
    return { vetoed: true, reason: 'Branch requires a schema change' };
  }
  return { vetoed: false };
}

export function buildPaths(
  nodes: readonly DecisionNode[],
  branches: readonly Branch[],
  spine: readonly SpineSegment[],
  intent: Intent,
  options: RankOptions,
): PathCandidate[] {
  const alive = options.dependencyAlive ?? (() => true);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const out: PathCandidate[] = [];

  for (const branch of branches) {
    if (!nodeById.has(branch.nodeId)) continue;
    const raw = computeRawFacts(branch, spine, options.now, alive);
    const facts = computeFacts(raw, intent);
    const veto = evaluateVeto(intent, branch, facts);

    const base = facts.intentFit * facts.applicability - (facts.migrationCost + facts.residualRisk);
    const score = round(base * facts.freshness, 4);

    const arithmetic: ArithmeticStep[] = [
      {
        label: 'Intent fit',
        expression: intentFit(intent, facts).expression,
        value: round(facts.intentFit, 4),
      },
      {
        label: 'Applicability',
        expression: `${branch.requiredDependencies.length} dependencies checked`,
        value: round(facts.applicability, 4),
      },
      {
        label: 'Migration cost',
        expression: `${raw.migrationRaw} dependent object(s) unwound ÷ ${MIGRATION_NORMALISER}`,
        value: round(facts.migrationCost, 4),
      },
      {
        label: 'Residual risk',
        expression: `${raw.residualRaw} unresolved segment(s) retained ÷ ${RESIDUAL_NORMALISER}`,
        value: round(facts.residualRisk, 4),
      },
      {
        label: 'Freshness',
        expression: 'share of branch evidence not superseded',
        value: round(facts.freshness, 4),
      },
      {
        label: 'Score',
        expression: '(fit × applicability − (migration + residual)) × freshness',
        value: score,
      },
    ];

    out.push({
      pathId: `path_${branch.id}`,
      branchId: branch.id,
      nodeId: branch.nodeId,
      label: branch.label,
      facts,
      score,
      disqualified: veto.vetoed,
      ...(veto.reason ? { vetoReason: veto.reason } : {}),
      arithmetic,
    });
  }

  return out;
}

export function rankPaths(paths: readonly PathCandidate[]): PathCandidate[] {
  return [...paths].sort((a, b) => {
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
    return b.score - a.score;
  });
}

export function buildGraft(
  best: PathCandidate,
  branch: Branch,
  spine: readonly SpineSegment[],
): Graft {
  const divergence = spine.find((s) => s.nodeId === branch.nodeId);
  const divergenceOrder = divergence?.order ?? Number.POSITIVE_INFINITY;
  const unwoundIds = new Set(branch.unwindsNodeIds);

  const keep: Graft['keep'] = [];
  const unwind: Graft['unwind'] = [];

  for (const segment of spine) {
    if (unwoundIds.has(segment.nodeId)) {
      unwind.push({
        nodeId: segment.nodeId,
        ari: segment.ari,
        title: segment.title,
        dependentCount: segment.dependentCount,
      });
    } else if (segment.order <= divergenceOrder) {
      keep.push({
        nodeId: segment.nodeId,
        ari: segment.ari,
        title: segment.title,
        dependentCount: segment.dependentCount,
      });
    }
  }

  return {
    keep,
    graft: { branchId: best.branchId, label: branch.label, ari: divergence?.ari ?? branch.nodeId },
    unwind,
  };
}

export function decide(
  ranked: readonly PathCandidate[],
  branches: readonly Branch[],
  spine: readonly SpineSegment[],
  intent: Intent,
): Recommendation {
  const usable = ranked.filter((p) => !p.disqualified);
  const best = usable[0];

  if (!best) {
    const closest = ranked[0] ?? null;
    const unmapped = intent.hardConstraints.filter((c) => detectConstraintTags([c]).length === 0);
    const failing =
      closest?.vetoReason ??
      (unmapped.length > 0
        ? `Hard constraint could not be evaluated: "${unmapped[0]}"`
        : 'No branch carries evidence of a viable alternative');
    return {
      kind: 'noEvidencedPath',
      closest,
      failingCriterion: failing,
      note: 'Closing this gap needs a path with no graph precedent. That is unsupported and requires validation.',
    };
  }

  const branch = branches.find((b) => b.id === best.branchId);
  const graft = branch ? buildGraft(best, branch, spine) : null;

  if (!graft) {
    return {
      kind: 'noEvidencedPath',
      closest: best,
      failingCriterion: 'Best branch has no spine divergence point',
      note: 'The traversal did not locate the node this branch diverges from.',
    };
  }

  return {
    kind: 'graft',
    best,
    graft,
    alternates: usable.slice(1),
  };
}

export function summariseScores(scores: readonly BranchScore[]): {
  highestGap: BranchScore | null;
  meanGap: number;
} {
  if (scores.length === 0) return { highestGap: null, meanGap: 0 };
  const sorted = [...scores].sort((a, b) => b.gap - a.gap);
  return {
    highestGap: sorted[0] ?? null,
    meanGap: round(sum(scores.map((s) => s.gap)) / scores.length, 4),
  };
}
