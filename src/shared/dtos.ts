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
}

export interface BranchViewDto {
  id: string;
  nodeId: string;
  label: string;
  taken: boolean;
  score: BranchScore;
  evidenceArIs: string[];
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
