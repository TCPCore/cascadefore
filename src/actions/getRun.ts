import { repository } from '../bootstrap';
import { forecastRun, NO_PRECEDENT } from '../domain/forecast';
import type { Recommendation } from '../shared/types';

/**
 * Reads a persisted reconstruction back.
 *
 * The reconstruct action returns a summary and a run id; this is how a caller —
 * or the Rovo agent — fetches the detail without re-running anything. It is
 * real surface, not scaffolding: the run already exists in Forge SQL.
 */
export async function getRunAction(event: unknown): Promise<Record<string, unknown>> {
  const input = extractInput(event);
  if (!input.runId) {
    return { error: 'NO_RUN_ID', message: 'Pass a runId returned by reconstruct-decision.' };
  }

  const snapshot = await repository().get(input.runId);
  if (!snapshot) {
    return { error: 'NOT_FOUND', message: `No run ${input.runId} for this installation.` };
  }

  const recommendation: Recommendation | null = snapshot.recommendation;

  // Additive: a forecast per path, computed from the stored facts and scores.
  // No precedent counts are available yet, so every entry carries grade C and a
  // caveat saying the number is the fact assessment, not evidence.
  const forecast = forecastRun(
    snapshot.paths,
    snapshot.branches.map((b) => ({ branchId: b.id, knowability: b.score.knowability })),
    NO_PRECEDENT,
  );

  return {
    runId: snapshot.runId,
    status: snapshot.status,
    evidenceSource: snapshot.evidenceSource,
    event: snapshot.event,
    intent: snapshot.intent,
    stats: snapshot.stats,
    recommendation:
      recommendation?.kind === 'graft'
        ? { kind: 'graft', path: recommendation.best.label, score: recommendation.best.score }
        : recommendation
          ? { kind: recommendation.kind, failingCriterion: recommendation.failingCriterion }
          : null,
    forecast: forecast.map((entry) => ({
      branchId: entry.branchId,
      label: entry.label,
      probability: entry.prediction.probability,
      interval: entry.prediction.interval,
      grade: entry.prediction.grade,
      baseRate: entry.prediction.baseRate,
      evidenceCount: entry.prediction.evidenceCount,
      caveat: entry.prediction.caveat,
    })),
    decisions: snapshot.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title,
      decidedAt: node.decidedAt,
    })),
    branches: snapshot.branches.map((branch) => ({
      id: branch.id,
      label: branch.label,
      taken: branch.taken,
      gap: branch.score.gap,
      evidenced: branch.projection?.evidenced ?? false,
    })),
  };
}

interface Input {
  runId?: string;
}

function extractInput(event: unknown): Input {
  if (!event || typeof event !== 'object') return {};
  const record = event as Record<string, unknown>;
  const candidate = (record.input ?? record.payload ?? record) as Record<string, unknown>;
  return typeof candidate.runId === 'string' ? { runId: candidate.runId } : {};
}
