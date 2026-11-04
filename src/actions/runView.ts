import type { RunSnapshotDto } from '../shared/dtos';
import { buildTimeline, timelineInputFrom } from '../domain/timeline';
import { treeAt, describeTree } from '../domain/asOf';
import { forecastRun, NO_PRECEDENT } from '../domain/forecast';

/**
 * One run view, built in one place.
 *
 * The panel reads this through the resolver, external clients read it through
 * the MCP action. They used to build it separately, which is how the resolver
 * ended up returning a bare snapshot while the action returned the forensic
 * layer — the panel then rendered an empty tab with no error.
 */
export function buildRunView(snapshot: RunSnapshotDto) {
  const view = timelineInputFrom(snapshot);
  const timeline = buildTimeline(view);
  const asOf = treeAt(view, snapshot.event.at);

  let forecast: ReturnType<typeof forecastRun> = [];
  try {
    forecast = forecastRun(
      snapshot.paths,
      snapshot.branches.map((b) => ({ branchId: b.id, knowability: b.score.knowability })),
      NO_PRECEDENT,
    );
  } catch {
    // A forecast is additive. It must never be the reason a reconstruction
    // cannot be read back.
    forecast = [];
  }

  const recommendation = snapshot.recommendation;

  return {
    snapshot,
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
    timeline: {
      summary: describeTree(asOf),
      knowableThen: timeline.knowableThen,
      learnedSince: timeline.learnedSince,
      entries: timeline.entries.slice(-25).map((entry) => ({
        at: entry.at,
        kind: entry.kind,
        title: entry.title,
        ari: entry.ari,
        knowableAtAnchor: entry.knowableAtAnchor,
      })),
    },
    counterfactuals: snapshot.counterfactuals,
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
