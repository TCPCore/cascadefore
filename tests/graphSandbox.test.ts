import { describe, expect, it } from 'vitest';

import { runPersistedQuery, type GraphCaller } from '../src/graph/client';
import {
  createRecordedCaller,
  envelope,
  SANDBOX_PAGES,
  type RecordedOptions,
} from '../src/graph/sandbox';
import { createGraphSource, probeScopes, mapSpineRows } from '../src/graph/source';
import type { RawArtifact } from '../src/graph/extract';

const NOW = '2026-11-02T12:00:00.000Z';
const noSleep = async (): Promise<void> => undefined;

function collectArtifacts(caller: GraphCaller, options: RecordedOptions = {}) {
  return runPersistedQuery(
    caller,
    'spine',
    { workItemKey: 'CX-11', limit: 25 },
    (rows) => mapSpineRows(rows, NOW),
    { sleep: noSleep, ...options },
  );
}

describe('graph sandbox', () => {
  it('pages through every recorded page and reports the count', async () => {
    const caller = createRecordedCaller(SANDBOX_PAGES);
    const result = await collectArtifacts(caller);

    expect(result.errorCode).toBeNull();
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(false);
    // page 1 → one page artifact + one work item; page 2 → one comment + one work item
    expect(result.rows.length).toBeGreaterThanOrEqual(3);
  });

  it('drives paging off hasNextPage, not row count', async () => {
    // A single row on the first page that still has a next page.
    const caller = createRecordedCaller({
      spine: [
        [{ page: { __typename: 'CypherQueryResultNode', id: 'p1', data: { __typename: 'ConfluencePage', title: 'A', createdAt: NOW } } }],
        [{ page: { __typename: 'CypherQueryResultNode', id: 'p2', data: { __typename: 'ConfluencePage', title: 'B', createdAt: NOW } } }],
      ],
    });
    const result = await collectArtifacts(caller);
    expect(result.pages).toBe(2);
    expect(result.rows).toHaveLength(2);
  });

  it('treats a missing pageInfo as the end of the cursor', async () => {
    const caller = createRecordedCaller(SANDBOX_PAGES, { omitPageInfo: true });
    const result = await collectArtifacts(caller);
    expect(result.pages).toBe(1);
    expect(result.errorCode).toBeNull();
  });

  it('retries QUERY_NOT_FOUND during the registration window, then succeeds', async () => {
    const caller = createRecordedCaller(SANDBOX_PAGES, { notFoundForFirst: 2 });
    const result = await collectArtifacts(caller);
    expect(result.errorCode).toBeNull();
    expect(result.pages).toBe(2);
    expect(caller.totalCalls()).toBe(4); // 2 rejected + 2 accepted
  });

  it('gives up after the retry budget and surfaces the code', async () => {
    const caller = createRecordedCaller(SANDBOX_PAGES, { notFoundForFirst: 99 });
    const result = await collectArtifacts(caller);
    expect(result.errorCode).toBe('QUERY_NOT_FOUND');
    expect(result.rows).toHaveLength(0);
  });

  it('surfaces fatal codes without retrying', async () => {
    const caller = createRecordedCaller(SANDBOX_PAGES, { fatalCode: 'NOT_OWNER' });
    const result = await collectArtifacts(caller);
    expect(result.errorCode).toBe('NOT_OWNER');
    expect(caller.totalCalls()).toBe(1);
  });

  it('builds an envelope the transport can parse', async () => {
    const response = envelope(
      [{ page: { __typename: 'CypherQueryResultNode', id: 'x', data: { __typename: 'ConfluencePage', title: 'T' } } }],
      { hasNextPage: false, endCursor: null },
    );
    expect(response.errors).toBeUndefined();
    const data = response.data as { customQuery: { edges: unknown[] } };
    expect(data.customQuery.edges).toHaveLength(1);
  });
});

describe('graph source against the sandbox', () => {
  it('assembles spine, branch and outcome artefacts in one collect()', async () => {
    const caller = createRecordedCaller(SANDBOX_PAGES);
    const source = createGraphSource(caller, { spine: 'spine', branches: 'branches', outcomes: 'outcomes' }, {
      now: () => NOW,
    });

    const collection = await source.collect('CX-11');

    expect(collection.errorCode).toBeNull();
    expect(collection.traversalMs).toBeGreaterThanOrEqual(0);

    const types = new Set(collection.artifacts.map((a: RawArtifact) => a.type));
    expect(types.has('confluence-page')).toBe(true);
    expect(types.has('confluence-comment')).toBe(true);
    expect(types.has('external-build')).toBe(true);
  });

  it('carries outcome signal from the build artefact', async () => {
    const caller = createRecordedCaller(SANDBOX_PAGES);
    const source = createGraphSource(caller, { spine: 'spine', branches: 'branches', outcomes: 'outcomes' }, {
      now: () => NOW,
    });
    const collection = await source.collect('CX-11');
    const build = collection.artifacts.find((a) => a.type === 'external-build');
    expect(build?.outcome).toBe('passed');
    expect(build?.implementationProof).toBe(true);
  });

  it('probes scopes without throwing when the graph is empty', async () => {
    const caller = createRecordedCaller({});
    const probes = await probeScopes(caller, ['ConfluencePage', 'JiraWorkItem'], 'CX-11');
    expect(probes).toHaveLength(2);
    expect(probes.every((p) => p.yielded)).toBe(true);
  });
});
