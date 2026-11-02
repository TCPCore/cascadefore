import type {
  Branch,
  BranchScore,
  DecisionNode,
  Horizon,
  Intent,
  Iso,
  PathCandidate,
  ScopeProbeResult,
} from '../shared/types';
import type { RunSnapshotDto, RunStage } from '../shared/dtos';
import { assemble, type RawArtifact } from '../graph/extract';
import { scoreBranches } from '../domain/scoring';
import { buildPaths, decide, rankPaths } from '../domain/graft';
import { buildSnapshot } from '../storage/runs';

export interface GraphCollection {
  artifacts: RawArtifact[];
  scopeProbe: ScopeProbeResult[];
  errorCode: string | null;
  traversalMs: number;
}

export interface GraphSource {
  collect(workItemKey: string): Promise<GraphCollection>;
}

export interface PipelineInput {
  runId: string;
  workItemKey: string;
  intentText?: string;
  horizon?: Horizon;
  failureAt: Iso;
  createdAt: Iso;
}

export interface PipelineDeps {
  source: GraphSource;
  parseIntent: (text: string, horizon?: Horizon) => Promise<Intent>;
  now: () => Iso;
  writeDossier?: (snapshot: RunSnapshotDto) => Promise<string | null>;
  onStage?: (stage: RunStage) => Promise<void>;
}

export interface PipelineResult {
  snapshot: RunSnapshotDto;
  nodes: DecisionNode[];
}

function pairScores(branches: readonly Branch[], scores: readonly BranchScore[]): Array<{ branch: Branch; score: BranchScore }> {
  const byId = new Map(scores.map((s) => [s.branchId, s]));
  const out: Array<{ branch: Branch; score: BranchScore }> = [];
  for (const branch of branches) {
    const score = byId.get(branch.id);
    if (score) out.push({ branch, score });
  }
  return out;
}

function emptySnapshot(
  input: PipelineInput,
  intent: Intent,
  collection: GraphCollection,
  status: RunSnapshotDto['status'],
  errorCode: string | null,
  scoringMs: number,
): RunSnapshotDto {
  return buildSnapshot({
    runId: input.runId,
    workItemKey: input.workItemKey,
    workItemAri: `ari:cloud:jira::issue/${input.workItemKey}`,
    failureAt: input.failureAt,
    status,
    stage: 'done',
    intent,
    nodes: [],
    spine: [],
    branches: [],
    paths: [],
    recommendation: null,
    scopeProbe: collection.scopeProbe,
    stats: {
      nodeCount: 0,
      branchCount: 0,
      evidenceCount: 0,
      traversalMs: collection.traversalMs,
      scoringMs,
    },
    dossierUrl: null,
    errorCode,
    createdAt: input.createdAt,
  });
}

/**
 * The whole reconstruction, with every external dependency injected.
 *
 * Ordering matters: the intent is resolved *before* scoring, because intent
 * changes the ranking, not the scores. Knowability and viability are
 * intent-independent by design — that is what makes the then/now comparison
 * honest.
 */
export async function runPipeline(input: PipelineInput, deps: PipelineDeps): Promise<PipelineResult> {
  const intent = await deps.parseIntent(input.intentText ?? '', input.horizon);

  await deps.onStage?.('traversing');
  const collection = await deps.source.collect(input.workItemKey);

  if (collection.errorCode) {
    return {
      snapshot: emptySnapshot(input, intent, collection, 'failed', collection.errorCode, 0),
      nodes: [],
    };
  }

  await deps.onStage?.('extracting');
  const assembly = assemble(collection.artifacts, input.failureAt);

  if (assembly.nodes.length === 0) {
    return {
      snapshot: emptySnapshot(input, intent, collection, 'empty', null, 0),
      nodes: [],
    };
  }

  await deps.onStage?.('scoring');
  const scoringStart = Date.now();
  const scores = scoreBranches(assembly.nodes, assembly.branches);

  await deps.onStage?.('ranking');
  const now = deps.now();
  const paths: PathCandidate[] = buildPaths(assembly.nodes, assembly.branches, assembly.spine, intent, { now });
  const ranked = rankPaths(paths);
  const recommendation = decide(ranked, assembly.branches, assembly.spine, intent);
  const scoringMs = Date.now() - scoringStart;

  const paired = pairScores(assembly.branches, scores);

  const snapshot = buildSnapshot({
    runId: input.runId,
    workItemKey: input.workItemKey,
    workItemAri: `ari:cloud:jira::issue/${input.workItemKey}`,
    failureAt: input.failureAt,
    status: 'loaded',
    stage: 'done',
    intent,
    nodes: assembly.nodes,
    spine: assembly.spine,
    branches: paired,
    paths: ranked,
    recommendation,
    scopeProbe: collection.scopeProbe,
    stats: {
      nodeCount: assembly.nodes.length,
      branchCount: assembly.branches.length,
      evidenceCount: collection.artifacts.length,
      traversalMs: collection.traversalMs,
      scoringMs,
    },
    dossierUrl: null,
    errorCode: null,
    createdAt: input.createdAt,
  });

  await deps.onStage?.('persisting');

  if (deps.writeDossier) {
    try {
      const url = await deps.writeDossier(snapshot);
      if (url) snapshot.dossierUrl = url;
    } catch {
      // A missing dossier must never fail the run: it is a convenience artefact,
      // not the finding. The panel degrades to "copy as comment".
      snapshot.dossierUrl = null;
    }
  }

  return { snapshot, nodes: assembly.nodes };
}
