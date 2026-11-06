import { describe, expect, it } from 'vitest';

import { searchDecisions, whyIsThisLikeThis } from '../src/decisions/search';
import { computeCaseBase } from '../src/decisions/service';

const decisions = (await computeCaseBase()).models;

describe('search decisions', () => {
  it('finds a decision by the technology named in a question', async () => {
    const result = await searchDecisions({ text: 'why does the billing service use Postgres' }, decisions);
    expect(result.hits[0]?.decision).toMatch(/Postgres/i);
  });

  it('explains why each hit matched', async () => {
    const result = await searchDecisions({ text: 'Postgres' }, decisions);
    expect(result.hits[0]?.because.length).toBeGreaterThan(0);
  });

  it('finds a decision through the alternative it rejected', async () => {
    const result = await searchDecisions({ text: 'mongodb' }, decisions);
    expect(result.hits.some((hit) => hit.alternatives.some((alt) => /mongodb/i.test(alt.name)))).toBe(true);
  });

  it('filters by status', async () => {
    const result = await searchDecisions({ status: 'violated' }, decisions);
    expect(result.hits.every((hit) => hit.status === 'violated')).toBe(true);
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it('filters by area', async () => {
    const result = await searchDecisions({ area: 'datastore' }, decisions);
    expect(result.hits.every((hit) => hit.domain.includes('datastore'))).toBe(true);
  });

  it('returns a helpful summary when nothing matches, without inventing a hit', async () => {
    const result = await searchDecisions({ text: 'kubernetes' }, decisions);
    expect(result.hits).toHaveLength(0);
    expect(result.summary).toMatch(/no decision matches/i);
  });

  it('caps results so an agent cannot pull the whole index', async () => {
    const result = await searchDecisions({ limit: 2 }, decisions);
    expect(result.hits.length).toBeLessThanOrEqual(2);
  });
});

describe('why is this like this', () => {
  it('answers with the decisions and their rationale', async () => {
    const result = await whyIsThisLikeThis({ subject: 'Postgres', source: decisions });
    expect(result.decisions[0]?.rationale.length).toBeGreaterThan(0);
    expect(result.summary).toMatch(/decision/i);
  });

  it('admits when the index cannot explain the subject', async () => {
    const result = await whyIsThisLikeThis({ subject: 'graphql federation', source: decisions });
    expect(result.decisions).toHaveLength(0);
    expect(result.summary).toMatch(/never recorded|nothing in the index/i);
  });
});
