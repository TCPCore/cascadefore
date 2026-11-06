import { describe, expect, it } from 'vitest';

import { searchDecisionsAction, whyIsThisLikeThisAction } from '../src/actions/searchDecisions';
import { decisionMatrixAction } from '../src/actions/decisionMatrix';
import { findPrecedentAction } from '../src/actions/findPrecedent';

/**
 * Action-level contract tests.
 *
 * These are the exact handlers MCP and the agent call, so they assert the wire
 * shape rather than the domain logic: a handler that throws or returns an error
 * envelope is what a caller actually sees.
 */
describe('MCP action contracts', () => {
  it('search-decisions returns hits with reasons', async () => {
    const result = (await searchDecisionsAction({ input: { text: 'postgres' } })) as {
      hits: Array<{ id: string; because: string[] }>;
    };
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.because.length).toBeGreaterThan(0);
  });

  it('search-decisions defaults to the most recent when no text is given', async () => {
    const result = (await searchDecisionsAction({ input: {} })) as { hits: unknown[] };
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it('why-is-this-like-this asks for a subject instead of guessing', async () => {
    const result = (await whyIsThisLikeThisAction({ input: {} })) as { error?: string };
    expect(result.error).toBe('NO_SUBJECT');
  });

  it('why-is-this-like-this answers with rationale', async () => {
    const result = (await whyIsThisLikeThisAction({ input: { subject: 'Postgres' } })) as {
      decisions: Array<{ rationale: string }>;
    };
    expect(result.decisions[0]?.rationale.length).toBeGreaterThan(10);
  });

  it('decision-matrix aggregates by area by default', async () => {
    const result = (await decisionMatrixAction({ input: {} })) as {
      groupBy: string;
      rows: unknown[];
      totals: { decisions: number };
    };
    expect(result.groupBy).toBe('area');
    expect(result.totals.decisions).toBeGreaterThan(0);
  });

  it('find-precedent rejects a missing alternative instead of inventing one', async () => {
    const result = (await findPrecedentAction({ input: {} })) as { summary: string };
    expect(result.summary).toMatch(/no alternative named/i);
  });

  it('find-precedent splits precedent by the time gate', async () => {
    const result = (await findPrecedentAction({
      input: { alternativeText: 'MongoDB', asOf: '2026-03-14T10:00:00Z' },
    })) as { knownThen: Array<{ knowableAtOriginalDecision: boolean }>; learnedLater: Array<{ knowableAtOriginalDecision: boolean }> };
    expect(result.knownThen.every((p) => p.knowableAtOriginalDecision)).toBe(true);
    expect(result.learnedLater.every((p) => !p.knowableAtOriginalDecision)).toBe(true);
  });
});
