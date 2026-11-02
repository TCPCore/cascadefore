/**
 * Cascade domain model.
 *
 * Invariants enforced by construction and by the type system:
 *  - Every piece of evidence carries an ARI. A branch with zero evidence is
 *    unrepresentable as a scored branch and therefore unrenderable.
 *  - Decision nodes are *synthesised* from evidence; Teamwork Graph has no
 *    `Decision` object type.
 *  - Scores are numbers derived from counted facts, never from model output.
 */

export type Ari = string;
/** ISO-8601 UTC timestamp, e.g. "2026-03-14T09:12:00.000Z". */
export type Iso = string;
export type DecisionKind = 'documented' | 'thread' | 'transition' | 'implicit';

export type EvidenceType =
  | 'confluence-page'
  | 'confluence-comment'
  | 'jira-comment'
  | 'jira-status'
  | 'jira-work-item'
  | 'external-build'
  | 'external-deployment'
  | 'external-pull-request'
  | 'goal';

export interface Evidence {
  ari: Ari;
  type: EvidenceType;
  createdAt: Iso;
  lastUpdated?: Iso;
  title: string;
  /** Fixed table value by type+shape. Never model-derived. */
  sourceAuthority: number;
  /** Author ARI, or component ARI, or page ARI — used to discount redundancy. */
  independenceKey: string;
  /** Evidence that this exact alternative was built/deployed successfully somewhere. */
  implementationProof: boolean;
  outcome: 'passed' | 'failed' | 'unknown';
  /** Set when a later decision reversed this evidence. */
  supersededAt?: Iso;
}

export interface DecisionNode {
  /** Deterministic: hash(kind + ":" + ari). */
  id: string;
  ari: Ari;
  kind: DecisionKind;
  title: string;
  decidedAt: Iso;
  actorAris: Ari[];
  /** Rule-derived, 0..1. Never exceeds 0.85 for `implicit` nodes. */
  confidence: number;
  evidence: Evidence[];
}

export interface Branch {
  id: string;
  /** The node at which this branch diverges from the spine. */
  nodeId: string;
  label: string;
  /** true = the choice the spine actually took. */
  taken: boolean;
  evidence: Evidence[];
  downstreamNodeIds: string[];
  /** Graph objects that must still exist for this path to be walkable today. */
  requiredDependencies: Ari[];
  /** Spine segments this branch contradicts and would require unwinding. */
  unwindsNodeIds: string[];
}

/** One segment of the actual (taken) path, ordered from the failure backwards. */
export interface SpineSegment {
  nodeId: string;
  ari: Ari;
  title: string;
  /** 0 = the decision closest to the failure. */
  order: number;
  /** How many graph objects depend on this segment. */
  dependentCount: number;
  /** false = this segment's own decision still looks unsound today. */
  resolved: boolean;
}

export interface ArithmeticStep {
  label: string;
  expression: string;
  value: number;
}

export interface BranchScore {
  branchId: string;
  knowability: number;
  viability: number;
  gap: number;
  confidence: number;
  knowableEvidenceAris: Ari[];
  withheldEvidenceAris: Ari[];
  arithmetic: ArithmeticStep[];
}

export type Horizon = 'weeks' | 'quarters' | 'years';

export interface Intent {
  goal: string;
  successCriteria: string[];
  hardConstraints: string[];
  softPreferences: string[];
  nonGoals: string[];
  horizon: Horizon;
  source: 'user' | 'goal-field' | 'inferred';
}

export interface PathFacts {
  migrationCost: number;
  residualRisk: number;
  applicability: number;
  freshness: number;
  intentFit: number;
}

export interface IntentFitBreakdown {
  value: number;
  weights: { migration: number; residual: number; freshness: number };
  expression: string;
}

export interface PathCandidate {
  pathId: string;
  branchId: string;
  nodeId: string;
  label: string;
  facts: PathFacts;
  /** (intentFit × applicability) − (migrationCost + residualRisk), × freshness. */
  score: number;
  disqualified: boolean;
  vetoReason?: string;
  arithmetic: ArithmeticStep[];
}

export interface GraftLane {
  nodeId: string;
  ari: Ari;
  title: string;
  dependentCount: number;
}

export interface Graft {
  keep: GraftLane[];
  graft: { branchId: string; label: string; ari: Ari };
  unwind: GraftLane[];
}

export type Recommendation =
  | { kind: 'graft'; best: PathCandidate; graft: Graft; alternates: PathCandidate[] }
  | {
      kind: 'noEvidencedPath';
      closest: PathCandidate | null;
      failingCriterion: string;
      note: string;
    };

export interface BranchScoreBundle {
  nodeId: string;
  branches: Array<{ branch: Branch; score: BranchScore }>;
}

export type RunStatus = 'queued' | 'running' | 'loaded' | 'empty' | 'failed';

export interface ScopeProbeResult {
  objectType: string;
  scope: string;
  yielded: boolean;
}
