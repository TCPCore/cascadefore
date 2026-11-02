import { describe, expect, it } from 'vitest';

import { planSeed, summarisePlan } from '../src/seed/plan';
import { applySeed, createMemorySeedClient } from '../src/seed/apply';

const base = { spaceKey: 'DECISIONS', projectKey: 'PAY' };

describe('seed planning', () => {
  it('plans the full scene on a cold install', () => {
    const plan = planSeed(base);
    expect(summarisePlan(plan)).toEqual({ createPage: 3, createIssue: 1, addComment: 1 });
  });

  it('is idempotent against existing content', () => {
    const plan = planSeed({
      ...base,
      existingTitles: ['ADR-014: keep the billing schema unsharded'],
      existingIssueSummaries: ['Checkout build failed'],
    });
    expect(summarisePlan(plan)).toEqual({ createPage: 2, createIssue: 0, addComment: 1 });
  });

  it('produces stable operation ids across runs', () => {
    const a = planSeed(base).map((op) => op.opId);
    const b = planSeed(base).map((op) => op.opId);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it('writes ADR pages that carry an options-considered section', () => {
    const pages = planSeed(base).filter((op) => op.kind === 'createPage');
    for (const page of pages) {
      if (page.kind !== 'createPage') continue;
      expect(page.body).toMatch(/## Options considered/);
      expect(page.body).toMatch(/## Decision outcome/);
    }
  });

  it('keeps the unanswered alternative as a page comment', () => {
    const comment = planSeed(base).find((op) => op.kind === 'addComment');
    expect(comment?.kind).toBe('addComment');
    if (comment?.kind !== 'addComment') return;
    expect(comment.targetKind).toBe('page');
    expect(comment.body).toMatch(/range-shard/);
  });
});

describe('seed execution', () => {
  it('applies every operation in order', async () => {
    const client = createMemorySeedClient();
    const outcome = await applySeed(planSeed(base), client);

    expect(outcome.failed).toEqual([]);
    expect(outcome.applied).toHaveLength(5);
    expect(client.pages).toHaveLength(3);
    expect(client.issues).toHaveLength(1);
    expect(client.comments).toHaveLength(1);
  });

  it('records a failure per operation instead of aborting', async () => {
    const client = createMemorySeedClient();
    const failing = {
      ...client,
      async createPage(input: { spaceKey: string; title: string; body: string }) {
        if (input.title.startsWith('ADR-014')) throw new Error('space is read-only');
        return client.createPage(input);
      },
    };

    const outcome = await applySeed(planSeed(base), failing);

    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]?.opId).toContain('adr-014');
    expect(outcome.applied).toHaveLength(4);
  });

  it('can be re-run after planning against what it created', async () => {
    const client = createMemorySeedClient();
    await applySeed(planSeed(base), client);

    const secondPlan = planSeed({
      ...base,
      existingTitles: client.pages.map((p) => p.title),
      existingIssueSummaries: client.issues.map((i) => i.summary),
    });

    // Only the comment is re-planned; pages and the issue already exist.
    expect(summarisePlan(secondPlan)).toEqual({ createPage: 0, createIssue: 0, addComment: 1 });
  });
});
