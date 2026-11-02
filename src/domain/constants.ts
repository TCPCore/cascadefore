import type { EvidenceType, Horizon } from '../shared/types.js';

/**
 * Fixed authority table. These numbers are a product decision, not a model
 * output: a signed ADR outranks a passing comment, and a green build outranks
 * both because it is an observed fact rather than an assertion.
 */
export const AUTHORITY: Record<EvidenceType, number> = {
  'confluence-page': 0.9,
  'confluence-comment': 0.65,
  'jira-comment': 0.6,
  'jira-status': 0.5,
  'jira-work-item': 0.55,
  'external-build': 0.95,
  'external-deployment': 0.95,
  'external-pull-request': 0.8,
  goal: 0.75,
};

/** Half-life for recency decay applied to knowability only. */
export const RECENCY_HALF_LIFE_DAYS = 180;
export const RECENCY_FLOOR = 0.2;

/** Outcome multipliers for viability. A failed attempt is weak evidence of viability. */
export const OUTCOME_FACTOR = { passed: 1, failed: 0.15, unknown: 0.6 } as const;

/** Structural caps keep the tree legible on a 1080p demo recording. */
export const MAX_BRANCHES_PER_NODE = 3;
export const MAX_SPINE_DEPTH = 6;
export const MAX_VISIBLE_LEVELS = 4;

/** An implicit node can never be more confident than this. */
export const IMPLICIT_CONFIDENCE_CAP = 0.85;

export const INTENT_WEIGHTS: Record<
  Horizon,
  { migration: number; residual: number; freshness: number }
> = {
  weeks: { migration: 0.6, residual: 0.25, freshness: 0.15 },
  quarters: { migration: 0.4, residual: 0.4, freshness: 0.2 },
  years: { migration: 0.15, residual: 0.65, freshness: 0.2 },
};

/** Normalisers turn raw graph counts into 0..1 without hiding the raw count. */
export const MIGRATION_NORMALISER = 8;
export const RESIDUAL_NORMALISER = 5;
