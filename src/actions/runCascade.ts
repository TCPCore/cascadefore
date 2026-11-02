import { buildDeps, isDemoMode, repository } from '../bootstrap';
import { loadConfig, assertConfigured } from '../config';
import { runPipeline } from '../pipeline/run';
import { newRunId } from '../shared/ids';
import type { EvidenceSource, Horizon } from '../shared/types';

const EVIDENCE_SOURCES: EvidenceSource[] = ['real_confluence_thread', 'seeded_fixture', 'graph', 'recorded_graph'];

interface ActionInput {
  workItemKey?: string;
  intent?: string;
  horizon?: Horizon;
}

/**
 * Exposed as a `rovo:action`, which makes it reachable from the Rovo Agent and
 * from the MCP server (a single action, three surfaces). The 55-second action
 * budget is enough for a seeded or modestly sized graph.
 */
export async function runCascadeAction(event: unknown): Promise<{ summary: string; runId: string }> {
  const input = extractInput(event);
  const workItemKey = input.workItemKey;
  if (!workItemKey) {
    return { summary: 'Cascade needs a work item key, e.g. BILL-142.', runId: '' };
  }

  const config = loadConfig();
  // Demo mode deliberately runs without registered graph queries; only the real
  // graph path needs them.
  if (!isDemoMode()) assertConfigured(config);
  const runId = newRunId();
  const createdAt = new Date().toISOString();
  // Provenance is explicit, never inferred from behaviour: a caller must be able
  // to tell a real-thread reconstruction from a fixture without reading source.
  const configured = process.env.CASCADE_EVIDENCE_SOURCE as EvidenceSource | undefined;
  const evidenceSource: EvidenceSource =
    configured && EVIDENCE_SOURCES.includes(configured)
      ? configured
      : isDemoMode()
        ? 'seeded_fixture'
        : 'graph';

  const result = await runPipeline(
    {
      runId,
      evidenceSource,
      workItemKey,
      intentText: input.intent,
      horizon: input.horizon,
      failureAt: createdAt,
      createdAt,
    },
    buildDeps(config),
  );

  const repo = repository();
  await repo.create(runId, workItemKey, createdAt, result.snapshot.intent);
  await repo.save(result.snapshot, result.nodes);

  return { summary: summarise(result.snapshot), runId };
}

function extractInput(event: unknown): ActionInput {
  if (!event || typeof event !== 'object') return {};
  const record = event as Record<string, unknown>;
  const candidate = (record.input ?? record.payload ?? record) as Record<string, unknown>;
  return {
    workItemKey: typeof candidate.workItemKey === 'string' ? candidate.workItemKey : undefined,
    intent: typeof candidate.intent === 'string' ? candidate.intent : undefined,
    horizon:
      candidate.horizon === 'weeks' || candidate.horizon === 'quarters' || candidate.horizon === 'years'
        ? candidate.horizon
        : undefined,
  };
}

function summarise(snapshot: { recommendation: unknown; branches: unknown[]; nodes: unknown[] }): string {
  const rec = snapshot.recommendation as
    | { kind: 'graft'; best: { label: string; score: number } }
    | { kind: 'noEvidencedPath'; failingCriterion: string }
    | null;

  if (!rec) return 'Cascade found no decision evidence for this work item.';
  if (rec.kind === 'noEvidencedPath') {
    return `Cascade found no evidenced path. ${rec.failingCriterion}`;
  }
  return `Cascade reconstructed ${snapshot.nodes.length} decisions and ${snapshot.branches.length} branches. Recommended graft: "${rec.best.label}" (score ${rec.best.score.toFixed(2)}).`;
}
