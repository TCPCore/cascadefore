import type { Projection } from '../domain/projection';
import type { EventContext } from '../domain/events';
import type { EvidenceSource } from './types';
import type {
  Branch,
  BranchScore,
  DecisionNode,
  Graft,
  Intent,
  PathCandidate,
  Recommendation,
  ScopeProbeResult,
  SpineSegment,
} from './types';

export interface TreeNodeDto {
  id: string;
  ari: string;
  kind: DecisionNode['kind'];
  title: string;
  decidedAt: string;
  confidence: number;
  evidenceCount: number;
  /** Timestamps behind the evidence, so a timeline can be dated correctly. */
  evidenceAt?: string[];
}

export interface BranchViewDto {
  id: string;
  nodeId: string;
  label: string;
  taken: boolean;
  score: BranchScore;
  evidenceArIs: string[];
  /** Timestamps aligned to evidenceArIs. */
  evidenceAt?: string[];
  /** Decisions this branch keeps alive (forward projection). */
  downstreamNodeIds?: string[];
  /** Spine segments this branch would unwind if taken. */
  unwindsNodeIds?: string[];
  /** What happens if this branch is taken. Evidence + arithmetic only. */
  projection: Projection | null;
  /** Plain-language forward consequences: what survives, what is undone, cost. */
  consequence: string[];
}

export interface ThenNowRowDto {
  branchId: string;
  label: string;
  knowability: number;
  viability: number;
  gap: number;
  knowableArIs: string[];
  withheldArIs: string[];
}

export interface RunStatsDto {
  nodeCount: number;
  branchCount: number;
  evidenceCount: number;
  traversalMs: number;
  scoringMs: number;
}

export type RunStage = 'queued' | 'traversing' | 'extracting' | 'scoring' | 'ranking' | 'persisting' | 'done';

export interface RunSnapshotDto {
  runId: string;
  /** What this graph is anchored around: build failure, incident, task, … */
  event: EventContext;
  /** Provenance of the evidence behind this run. */
  evidenceSource: EvidenceSource;
  /** Rejected alternatives with their reasons and time-gated precedent. */
  counterfactuals: Array<{
    name: string;
    rejectedBecause: string | null;
    knownThen: Array<{ decisionId: string; title: string; outcome: string }>;
    learnedLater: Array<{ decisionId: string; title: string; outcome: string }>;
    summary: string;
  }>;
  workItemKey: string;
  failureAt: string;
  status: 'queued' | 'running' | 'loaded' | 'empty' | 'failed';
  stage: RunStage;
  intent: Intent;
  nodes: TreeNodeDto[];
  spine: SpineSegment[];
  branches: BranchViewDto[];
  thenNow: ThenNowRowDto[];
  paths: PathCandidate[];
  recommendation: Recommendation | null;
  graft: Graft | null;
  scopeProbe: ScopeProbeResult[];
  stats: RunStatsDto;
  dossierUrl: string | null;
  errorCode: string | null;
  createdAt: string;
}

export interface StartRunRequest {
  workItemKey: string;
  intentText?: string;
  horizon?: Intent['horizon'];
}

export interface StartRunResponse {
  runId: string;
}

export type PanelMessage =
  | { type: 'ok'; snapshot: RunSnapshotDto }
  | { type: 'error'; code: string; message: string };

export type { Branch, BranchScore, DecisionNode, Graft, Intent, PathCandidate, Recommendation, ScopeProbeResult, SpineSegment };
