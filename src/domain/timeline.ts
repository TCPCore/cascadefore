import type { Iso } from '../shared/types';
import type { EventContext } from './events';
import type { RunSnapshotDto } from '../shared/dtos';

/**
 * The forensic timeline.
 *
 * The reconstruction already knows *what* was decided. This turns it into *how
 * we got here*: one ordered chronology anchored on an action, where every entry
 * is marked with whether it was knowable at the moment the action happened.
 *
 * That mark is the whole point. A timeline without it is a list of things that
 * occurred; a timeline with it shows what the people involved could actually see.
 */

export type TimelineKind = 'action' | 'decision' | 'evidence' | 'outcome' | 'resolution';

export interface TimelineEntry {
  id: string;
  at: Iso;
  kind: TimelineKind;
  title: string;
  /** Where a reader can verify this. */
  ari: string | null;
  nodeId: string | null;
  branchId: string | null;
  /** True when this existed at or before the anchor's moment. */
  knowableAtAnchor: boolean;
  detail: string | null;
}

export interface Timeline {
  anchorAt: Iso;
  anchor: EventContext;
  entries: TimelineEntry[];
  /** Entries the people involved could see at the time. */
  knowableThen: number;
  /** Entries that only became visible afterwards. */
  learnedSince: number;
}

function entryAt(iso: string | undefined | null): number {
  const parsed = Date.parse(iso ?? '');
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** Structural minimum — the stored DTO and the domain type both satisfy this. */
export interface TimelineNode {
  id: string;
  ari: string;
  title: string;
  decidedAt: Iso;
  kind?: string;
  confidence?: number;
  evidence?: ReadonlyArray<{ ari: string; type?: string; title?: string; createdAt: Iso }>;
}

export interface TimelineBranch {
  id: string;
  nodeId: string;
  label: string;
  taken: boolean;
  evidence?: ReadonlyArray<{ ari: string; createdAt: Iso }>;
}

export interface TimelineInput {
  anchor: EventContext;
  anchorAt: Iso;
  nodes: readonly TimelineNode[];
  branches: readonly TimelineBranch[];
  /** Observed outcomes, if the run has any. */
  outcomes?: ReadonlyArray<{ id: string; at: Iso; title: string; ari?: string; passed: boolean }>;
}

export function buildTimeline(input: TimelineInput): Timeline {
  const anchorTime = entryAt(input.anchorAt);
  const entries: TimelineEntry[] = [];

  entries.push({
    id: 'anchor',
    at: input.anchorAt,
    kind: 'action',
    title: input.anchor.title,
    ari: input.anchor.subjectAri ?? null,
    nodeId: null,
    branchId: null,
    knowableAtAnchor: true,
    detail: input.anchor.kind,
  });

  for (const node of input.nodes) {
    entries.push({
      id: `node:${node.id}`,
      at: node.decidedAt,
      kind: 'decision',
      title: node.title,
      ari: node.ari,
      nodeId: node.id,
      branchId: null,
      knowableAtAnchor: entryAt(node.decidedAt) <= anchorTime,
      detail: `${((node.confidence ?? 0) * 100).toFixed(0)}% confidence${node.kind ? ` · ${node.kind}` : ''}`,
    });

    // Evidence is dated, and evidence dated after the decision is the finding
    // that makes a decision look worse than it was.
    for (const item of node.evidence ?? []) {
      entries.push({
        id: `evidence:${item.ari}`,
        at: item.createdAt,
        kind: 'evidence',
        title: item.title ?? item.ari,
        ari: item.ari,
        nodeId: node.id,
        branchId: null,
        knowableAtAnchor: entryAt(item.createdAt) <= anchorTime,
        detail: item.type ?? null,
      });
    }
  }

  for (const branch of input.branches) {
    entries.push({
      id: `branch:${branch.id}`,
      at:
        (branch.evidence ?? []).reduce<Iso | null>(
          (earliest, item) =>
            earliest === null || entryAt(item.createdAt) < entryAt(earliest)
              ? item.createdAt
              : earliest,
          null,
        ) ?? input.anchorAt,
      kind: branch.taken ? 'resolution' : 'evidence',
      title: `${branch.taken ? 'resolved' : 'considered'}: ${branch.label}`,
      ari: branch.evidence?.[0]?.ari ?? null,
      nodeId: branch.nodeId,
      branchId: branch.id,
      knowableAtAnchor: (branch.evidence ?? []).every((item) => entryAt(item.createdAt) <= anchorTime),
      detail: branch.taken ? 'branch in force' : 'path not taken',
    });
  }

  for (const outcome of input.outcomes ?? []) {
    entries.push({
      id: `outcome:${outcome.id}`,
      at: outcome.at,
      kind: 'outcome',
      title: outcome.title,
      ari: outcome.ari ?? null,
      nodeId: null,
      branchId: null,
      knowableAtAnchor: entryAt(outcome.at) <= anchorTime,
      detail: outcome.passed ? 'passed' : 'failed',
    });
  }

  entries.sort((a, b) => entryAt(a.at) - entryAt(b.at));

  return {
    anchorAt: input.anchorAt,
    anchor: input.anchor,
    entries,
    knowableThen: entries.filter((e) => e.knowableAtAnchor).length,
    learnedSince: entries.filter((e) => !e.knowableAtAnchor).length,
  };
}

/**
 * Adapts a stored snapshot to timeline input.
 *
 * The DTO keeps evidence as parallel arrays (`evidenceArIs` / `evidenceAt`) so a
 * reader must re-pair them; doing that in one place stops every consumer from
 * inventing its own (and dating branches at the action by accident).
 */
export function timelineInputFrom(snapshot: RunSnapshotDto): TimelineInput {
  return {
    anchor: snapshot.event,
    anchorAt: snapshot.event.at,
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      ari: node.ari,
      title: node.title,
      decidedAt: node.decidedAt,
      kind: node.kind,
      confidence: node.confidence,
      evidence: (node.evidenceAt ?? []).map((createdAt, index) => ({
        ari: `${node.ari}#${index}`,
        createdAt,
      })),
    })),
    branches: snapshot.branches.map((branch) => ({
      id: branch.id,
      nodeId: branch.nodeId,
      label: branch.label,
      taken: branch.taken,
      evidence: branch.evidenceArIs.map((ari, index) => ({
        ari,
        createdAt: branch.evidenceAt?.[index] ?? snapshot.event.at,
      })),
    })),
  };
}

/** The world as it looked at `T` — the "see into the past" view. */
export function timelineAsOf(timeline: Timeline, asOf: Iso): Timeline {
  const cutoff = entryAt(asOf);
  const entries = timeline.entries.filter((entry) => entryAt(entry.at) <= cutoff);

  return {
    ...timeline,
    entries,
    knowableThen: entries.length,
    learnedSince: 0,
  };
}
