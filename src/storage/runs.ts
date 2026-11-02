import type {
  BranchScore,
  DecisionNode,
  Intent,
  PathCandidate,
  Recommendation,
  ScopeProbeResult,
  SpineSegment,
} from '../shared/types';
import type {
  BranchViewDto,
  RunSnapshotDto,
  RunStage,
  RunStatsDto,
  ThenNowRowDto,
  TreeNodeDto,
} from '../shared/dtos';
import type { Projection } from '../domain/projection';
import type { EvidenceSource } from '../shared/types';
import type { EventContext } from '../domain/events';
import type { SqlDriver } from './driver';
import { ensureSchema } from './schema';

/* ------------------------------------------------------------------ */
/* Time handling                                                       */
/* ------------------------------------------------------------------ */

/** MySQL DATETIME wants `YYYY-MM-DD HH:MM:SS`, not ISO-8601 with Z. */
export function toSqlDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '1970-01-01 00:00:00';
  return d.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
}

export function fromSqlDateTime(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
  }
  return new Date(0).toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Snapshot construction                                               */
/* ------------------------------------------------------------------ */

export interface SnapshotInput {
  runId: string;
  event: EventContext;
  evidenceSource: EvidenceSource;
  workItemKey: string;
  workItemAri: string;
  failureAt: string;
  status: RunSnapshotDto['status'];
  stage: RunStage;
  intent: Intent;
  nodes: DecisionNode[];
  spine: SpineSegment[];
  branches: Array<{
    branch: { id: string; nodeId: string; label: string; taken: boolean };
    score: BranchScore;
    projection?: Projection;
    consequence?: string[];
  }>;
  paths: PathCandidate[];
  recommendation: Recommendation | null;
  scopeProbe: ScopeProbeResult[];
  stats: RunStatsDto;
  dossierUrl: string | null;
  errorCode: string | null;
  createdAt: string;
}

export function buildSnapshot(input: SnapshotInput): RunSnapshotDto {
  const treeNodes: TreeNodeDto[] = input.nodes.map((n) => ({
    id: n.id,
    ari: n.ari,
    kind: n.kind,
    title: n.title,
    decidedAt: n.decidedAt,
    confidence: n.confidence,
    evidenceCount: n.evidence.length,
  }));

  const branches: BranchViewDto[] = input.branches.map(({ branch, score, projection, consequence }) => ({
    id: branch.id,
    nodeId: branch.nodeId,
    label: branch.label,
    taken: branch.taken,
    score,
    evidenceArIs: [...score.knowableEvidenceAris, ...score.withheldEvidenceAris],
    projection: projection ?? null,
    consequence: consequence ?? [],
  }));

  const thenNow: ThenNowRowDto[] = branches.map((b) => ({
    branchId: b.id,
    label: b.label,
    knowability: b.score.knowability,
    viability: b.score.viability,
    gap: b.score.gap,
    knowableArIs: b.score.knowableEvidenceAris,
    withheldArIs: b.score.withheldEvidenceAris,
  }));

  return {
    runId: input.runId,
    event: input.event,
    evidenceSource: input.evidenceSource,
    workItemKey: input.workItemKey,
    failureAt: input.failureAt,
    status: input.status,
    stage: input.stage,
    intent: input.intent,
    nodes: treeNodes,
    spine: input.spine,
    branches,
    thenNow,
    paths: input.paths,
    recommendation: input.recommendation,
    graft: input.recommendation?.kind === 'graft' ? input.recommendation.graft : null,
    scopeProbe: input.scopeProbe,
    stats: input.stats,
    dossierUrl: input.dossierUrl,
    errorCode: input.errorCode,
    createdAt: input.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Persistence statements                                              */
/* ------------------------------------------------------------------ */

export interface Statement {
  text: string;
  params: unknown[];
}

export function persistStatements(snapshot: RunSnapshotDto, nodes: readonly DecisionNode[]): Statement[] {
  const statements: Statement[] = [];

  statements.push({
    text: `INSERT INTO cascade_runs
      (run_id, work_item_key, work_item_ari, failure_at, status, stage, event_json, evidence_source,
       intent_json, intent_source, spine_json, recommendation_json, stats_json, scope_probe_json,
       dossier_url, error_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        stage = VALUES(stage),
        event_json = VALUES(event_json),
        evidence_source = VALUES(evidence_source),
        intent_json = VALUES(intent_json),
        intent_source = VALUES(intent_source),
        spine_json = VALUES(spine_json),
        recommendation_json = VALUES(recommendation_json),
        stats_json = VALUES(stats_json),
        scope_probe_json = VALUES(scope_probe_json),
        dossier_url = VALUES(dossier_url),
        error_code = VALUES(error_code),
        completed_at = VALUES(completed_at)`,
    params: [
      snapshot.runId,
      snapshot.workItemKey,
      `ari:cloud:jira::issue/${snapshot.workItemKey}`,
      toSqlDateTime(snapshot.failureAt),
      snapshot.status,
      snapshot.stage,
      JSON.stringify(snapshot.event),
      snapshot.evidenceSource,
      JSON.stringify(snapshot.intent),
      snapshot.intent.source,
      JSON.stringify(snapshot.spine),
      JSON.stringify(snapshot.recommendation),
      JSON.stringify(snapshot.stats),
      JSON.stringify(snapshot.scopeProbe),
      snapshot.dossierUrl,
      snapshot.errorCode,
      toSqlDateTime(snapshot.createdAt),
    ],
  });

  for (const node of nodes) {
    statements.push({
      text: `INSERT INTO cascade_nodes
        (run_id, node_id, ari, kind, title, decided_at, confidence, evidence_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE title = VALUES(title), confidence = VALUES(confidence)`,
      params: [
        snapshot.runId,
        node.id,
        node.ari,
        node.kind,
        node.title.slice(0, 500),
        toSqlDateTime(node.decidedAt),
        node.confidence,
        node.evidence.length,
      ],
    });

    for (const evidence of node.evidence) {
      statements.push({
        text: `INSERT INTO cascade_evidence
          (run_id, ari, node_id, type, title, created_at, authority, independence_key, proof, outcome)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE title = VALUES(title)`,
        params: [
          snapshot.runId,
          evidence.ari,
          node.id,
          evidence.type,
          evidence.title.slice(0, 500),
          toSqlDateTime(evidence.createdAt),
          evidence.sourceAuthority,
          evidence.independenceKey.slice(0, 250),
          evidence.implementationProof ? 1 : 0,
          evidence.outcome,
        ],
      });
    }
  }

  snapshot.branches.forEach((branch, index) => {
    statements.push({
      text: `INSERT INTO cascade_branches (run_id, branch_id, node_id, label, taken, score_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE label = VALUES(label), score_json = VALUES(score_json)`,
      params: [
        snapshot.runId,
        branch.id,
        branch.nodeId,
        branch.label.slice(0, 250),
        branch.taken ? 1 : 0,
        JSON.stringify({
          score: branch.score,
          projection: branch.projection,
          consequence: branch.consequence,
        }),
      ],
    });
    statements.push({
      text: `INSERT INTO cascade_paths
        (run_id, path_id, branch_id, rank_no, score, disqualified, path_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE score = VALUES(score), path_json = VALUES(path_json)`,
      params: [
        snapshot.runId,
        `path_${index}`,
        branch.id,
        index,
        branch.score.gap,
        branch.score.gap < 0 ? 1 : 0,
        JSON.stringify(branch.score),
      ],
    });
  });

  return statements;
}

/* ------------------------------------------------------------------ */
/* Hydration                                                           */
/* ------------------------------------------------------------------ */

export interface RunRow {
  run_id: string;
  work_item_key: string;
  event_json?: unknown;
  evidence_source?: string | null;
  failure_at: unknown;
  status: string;
  stage: string;
  intent_json: unknown;
  spine_json: unknown;
  recommendation_json: unknown;
  stats_json: unknown;
  scope_probe_json: unknown;
  dossier_url: string | null;
  error_code: string | null;
  created_at: unknown;
}

export interface NodeRow {
  node_id: string;
  ari: string;
  kind: string;
  title: string;
  decided_at: unknown;
  confidence: number;
  evidence_count: number;
}

export interface BranchRow {
  branch_id: string;
  node_id: string;
  label: string;
  taken: number;
  score_json: unknown;
}

export interface PathRow {
  path_id: string;
  branch_id: string;
  score: number;
  disqualified: number;
  path_json: unknown;
}

export function hydrate(
  run: RunRow,
  nodeRows: readonly NodeRow[],
  branchRows: readonly BranchRow[],
  pathRows: readonly PathRow[],
): RunSnapshotDto {
  const intent = parseJson<Intent>(run.intent_json, {
    goal: '',
    successCriteria: [],
    hardConstraints: [],
    softPreferences: [],
    nonGoals: [],
    horizon: 'weeks',
    source: 'inferred',
  });
  const spine = parseJson<SpineSegment[]>(run.spine_json, []);
  const recommendation = parseJson<Recommendation | null>(run.recommendation_json, null);
  const stats = parseJson<RunStatsDto>(run.stats_json, {
    nodeCount: nodeRows.length,
    branchCount: branchRows.length,
    evidenceCount: 0,
    traversalMs: 0,
    scoringMs: 0,
  });
  const scopeProbe = parseJson<ScopeProbeResult[]>(run.scope_probe_json, []);

  const nodes: TreeNodeDto[] = nodeRows.map((n) => ({
    id: n.node_id,
    ari: n.ari,
    kind: n.kind as TreeNodeDto['kind'],
    title: n.title,
    decidedAt: fromSqlDateTime(n.decided_at),
    confidence: Number(n.confidence),
    evidenceCount: Number(n.evidence_count),
  }));

  const branches: BranchViewDto[] = branchRows.map((b) => {
    const stored = parseJson<
      | { score: BranchScore; projection?: Projection; consequence?: string[] }
      | BranchScore
    >(b.score_json, {
      branchId: b.branch_id,
      knowability: 0,
      viability: 0,
      gap: 0,
      confidence: 0,
      knowableEvidenceAris: [],
      withheldEvidenceAris: [],
      arithmetic: [],
    });
    const isWrapper = 'score' in stored;
    const score = isWrapper ? stored.score : stored;
    const projection = isWrapper ? (stored.projection ?? null) : null;
    const consequence = isWrapper ? (stored.consequence ?? []) : [];
    return {
      id: b.branch_id,
      nodeId: b.node_id,
      label: b.label,
      taken: Boolean(b.taken),
      score,
      evidenceArIs: [...score.knowableEvidenceAris, ...score.withheldEvidenceAris],
      projection,
      consequence,
    };
  });

  const paths: PathCandidate[] = pathRows
    .map((p) => parseJson<PathCandidate | null>(p.path_json, null))
    .filter((p): p is PathCandidate => Boolean(p));

  const thenNow: ThenNowRowDto[] = branches.map((b) => ({
    branchId: b.id,
    label: b.label,
    knowability: b.score.knowability,
    viability: b.score.viability,
    gap: b.score.gap,
    knowableArIs: b.score.knowableEvidenceAris,
    withheldArIs: b.score.withheldEvidenceAris,
  }));

  return {
    runId: run.run_id,
    evidenceSource: (run.evidence_source as EvidenceSource) ?? 'seeded_fixture',
    event: parseJson<EventContext>(run.event_json, {
      kind: 'build-failure',
      subjectKey: run.work_item_key,
      subjectAri: `ari:cloud:jira::issue/${run.work_item_key}`,
      title: `Build failure ${run.work_item_key}`,
      at: fromSqlDateTime(run.failure_at),
    }),
    workItemKey: run.work_item_key,
    failureAt: fromSqlDateTime(run.failure_at),
    status: run.status as RunSnapshotDto['status'],
    stage: run.stage as RunStage,
    intent,
    nodes,
    spine,
    branches,
    thenNow,
    paths,
    recommendation,
    graft: recommendation?.kind === 'graft' ? recommendation.graft : null,
    scopeProbe,
    stats,
    dossierUrl: run.dossier_url,
    errorCode: run.error_code,
    createdAt: fromSqlDateTime(run.created_at),
  };
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export class RunRepository {
  constructor(private readonly driver: SqlDriver) {}

  async create(runId: string, workItemKey: string, failureAt: string, intent: Intent): Promise<void> {
    await ensureSchema(this.driver);
    await this.driver.query(
      `INSERT INTO cascade_runs
        (run_id, work_item_key, work_item_ari, failure_at, status, stage, intent_json, intent_source,
         spine_json, recommendation_json, stats_json, scope_probe_json, dossier_url, error_code, created_at)
        VALUES (?, ?, ?, ?, 'running', 'queued', ?, ?, '[]', 'null', '{}', '[]', NULL, NULL, ?)`,
      [
        runId,
        workItemKey,
        `ari:cloud:jira::issue/${workItemKey}`,
        toSqlDateTime(failureAt),
        JSON.stringify(intent),
        intent.source,
        toSqlDateTime(new Date().toISOString()),
      ],
    );
  }

  async setStage(runId: string, stage: RunStage): Promise<void> {
    await this.driver.query('UPDATE cascade_runs SET stage = ? WHERE run_id = ?', [stage, runId]);
  }

  async save(snapshot: RunSnapshotDto, nodes: readonly DecisionNode[]): Promise<void> {
    for (const statement of persistStatements(snapshot, nodes)) {
      await this.driver.query(statement.text, statement.params);
    }
  }

  async fail(runId: string, code: string): Promise<void> {
    await this.driver.query(
      `UPDATE cascade_runs SET status = 'failed', error_code = ?, completed_at = ? WHERE run_id = ?`,
      [code, toSqlDateTime(new Date().toISOString()), runId],
    );
  }

  async get(runId: string): Promise<RunSnapshotDto | null> {
    const runs = await this.driver.query<RunRow>('SELECT * FROM cascade_runs WHERE run_id = ? LIMIT 1', [runId]);
    const run = runs[0];
    if (!run) return null;

    const [nodes, branches, paths] = await Promise.all([
      this.driver.query<NodeRow>('SELECT * FROM cascade_nodes WHERE run_id = ?', [runId]),
      this.driver.query<BranchRow>('SELECT * FROM cascade_branches WHERE run_id = ?', [runId]),
      this.driver.query<PathRow>('SELECT * FROM cascade_paths WHERE run_id = ? ORDER BY rank_no ASC', [runId]),
    ]);

    return hydrate(run, nodes, branches, paths);
  }
}
