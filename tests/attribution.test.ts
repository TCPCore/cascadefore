import { describe, expect, it } from 'vitest';

import {
  attributeFromRows,
  decisionIdFromBuildName,
  summariseAttribution,
} from '../src/attribution/attribute';
import { runPersistedQuery } from '../src/graph/client';
import { createRecordedCaller, SANDBOX_ATTRIBUTION_PAGES, type RowSpec } from '../src/graph/sandbox';
import { ATTRIBUTION_QUERY, scopesFor } from '../src/graph/queries';
import type { RawRow } from '../src/graph/client';

function row(spec: RowSpec): RawRow {
  const columns: Record<string, Record<string, unknown> | null> = {};
  for (const [key, value] of Object.entries(spec)) columns[key] = value;
  return { columns };
}

describe('decision status names', () => {
  it('extracts the decision id from a commit status name', () => {
    expect(decisionIdFromBuildName('decision/0031-datastore-monitoring')).toBe('0031-datastore-monitoring');
  });

  it('ignores names that are not decision statuses', () => {
    expect(decisionIdFromBuildName('ci/build')).toBeNull();
    expect(decisionIdFromBuildName('decision/')).toBeNull();
    expect(decisionIdFromBuildName(undefined)).toBeNull();
  });
});

describe('attribution mapping', () => {
  it('flattens a rich row into typed events', () => {
    const events = attributeFromRows([
      row({
        build: {
          __typename: 'CypherQueryResultNode',
          id: 'ari:build/1',
          data: { __typename: 'ExternalBuild', name: 'decision/0031-datastore-monitoring', state: 'FAILED' },
        },
        workItem: {
          __typename: 'CypherQueryResultNode',
          id: 'ari:issue/CX-11',
          data: { __typename: 'JiraWorkItem', summary: 'Checkout build failed' },
        },
      }),
    ]);

    const build = events.find((e) => e.kind === 'build');
    expect(build?.decisionId).toBe('0031-datastore-monitoring');
    expect(build?.state).toBe('FAILED');
    expect(events.find((e) => e.kind === 'work-item')?.title).toBe('Checkout build failed');
  });

  it('drops nodes with no ARI or an unknown type', () => {
    const events = attributeFromRows([
      row({
        build: { __typename: 'CypherQueryResultNode', id: 'ari:build/1', data: { __typename: 'ExternalBuild', name: 'x' } },
        mystery: { __typename: 'CypherQueryResultNode', id: 'ari:mystery/1', data: { __typename: 'Unknown' } },
        nameless: { __typename: 'CypherQueryResultNode', data: { __typename: 'JiraWorkItem' } },
      }),
    ]);
    expect(events).toHaveLength(1);
  });

  it('deduplicates repeated objects across rows', () => {
    const build = {
      __typename: 'CypherQueryResultNode',
      id: 'ari:build/1',
      data: { __typename: 'ExternalBuild', name: 'decision/0012', state: 'SUCCESSFUL' },
    };
    const events = attributeFromRows([row({ build }), row({ build })]);
    expect(events).toHaveLength(1);
  });
});

describe('attribution summary', () => {
  it('counts by kind and extracts the decisions involved', () => {
    const events = attributeFromRows([
      row({
        build: {
          __typename: 'CypherQueryResultNode',
          id: 'ari:build/1',
          data: { __typename: 'ExternalBuild', name: 'decision/0031', state: 'FAILED' },
        },
      }),
      row({
        build: {
          __typename: 'CypherQueryResultNode',
          id: 'ari:build/2',
          data: { __typename: 'ExternalBuild', name: 'decision/0012', state: 'SUCCESSFUL' },
        },
        deployment: {
          __typename: 'CypherQueryResultNode',
          id: 'ari:deploy/1',
          data: { __typename: 'ExternalDeployment', state: 'COMPLETED' },
        },
      }),
    ]);

    const summary = summariseAttribution(events);
    expect(summary.builds).toBe(2);
    expect(summary.failedBuilds).toBe(1);
    expect(summary.deployments).toBe(1);
    expect(summary.decisions).toEqual(['0012', '0031']);
  });
});

describe('attribution query', () => {
  it('declares the scopes its traversal touches', () => {
    expect(scopesFor(ATTRIBUTION_QUERY)).toContain('read:graph:build:external');
    expect(scopesFor(ATTRIBUTION_QUERY)).toContain('read:graph:repository:external');
  });

  it('runs end to end against recorded payloads', async () => {
    const caller = createRecordedCaller(SANDBOX_ATTRIBUTION_PAGES);
    const result = await runPersistedQuery(caller, 'attribution', { decisionPrefix: 'decision/' }, (rows) => rows, {
      sleep: async () => undefined,
    });

    expect(result.errorCode).toBeNull();
    expect(result.pages).toBe(2);

    const events = attributeFromRows(result.rows);
    const summary = summariseAttribution(events);

    expect(summary.decisions).toEqual(['0012-use-postgres-primary', '0031-datastore-monitoring']);
    expect(summary.failedBuilds).toBe(1);
    expect(summary.workItems).toBe(1);
    expect(summary.pullRequests).toBe(1);
  });
});
