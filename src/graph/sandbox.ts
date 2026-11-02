import type { GraphCaller, GraphResponse, RawRow } from './client';

/**
 * Graph sandbox.
 *
 * A recorded stand-in for Teamwork Graph. It speaks the same wire format as the
 * real endpoint, so `runPersistedQuery`, `mapSpineRows` and `probeScopes` are
 * exercised for real — paging, cursors, error codes and all — without a site,
 * a scope grant, or a network call.
 *
 * This is the sandbox layer we were missing: the rest of the app could already
 * run offline (`createDemoSource`), but the graph client itself could not.
 */

export interface RecordedPage {
  rows: RawRow[];
}

export interface RecordedOptions {
  /** Simulate the registration propagation window: first N calls return QUERY_NOT_FOUND. */
  notFoundForFirst?: number;
  /** Simulate a fatal scope/ownership error. */
  fatalCode?: string;
  /** Simulate truncated/absent pageInfo. */
  omitPageInfo?: boolean;
}

type ColumnValue = Record<string, unknown> | null;

export interface RowSpec {
  [column: string]: ColumnValue;
}

function edgeFrom(row: RowSpec): { node: { columns: Array<{ key: string; value: ColumnValue }> } } {
  return {
    node: {
      columns: Object.entries(row).map(([key, value]) => ({ key, value })),
    },
  };
}

/** Builds the GraphQL response body the transport expects, from plain rows. */
export function envelope(
  rows: readonly RowSpec[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } | null,
): GraphResponse {
  return {
    data: {
      customQuery: {
        edges: rows.map(edgeFrom),
        ...(pageInfo ? { pageInfo } : {}),
      },
    },
  };
}

export interface RecordedCaller extends GraphCaller {
  /** How many calls the sandbox received, per queryKey. */
  readonly calls: Readonly<Record<string, number>>;
  totalCalls(): number;
}

/**
 * Serves canned pages per query key, following the `after` cursor.
 * Pages are consumed in order; a cursor of `null`/absent starts at page 0.
 */
export function createRecordedCaller(
  pages: Record<string, RowSpec[][]>,
  options: RecordedOptions = {},
): RecordedCaller {
  const calls: Record<string, number> = {};
  let notFoundRemaining = options.notFoundForFirst ?? 0;

  const caller = (async (
    _query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphResponse> => {
    const queryKey = String(variables?.queryKey ?? '');
    calls[queryKey] = (calls[queryKey] ?? 0) + 1;

    if (notFoundRemaining > 0) {
      notFoundRemaining -= 1;
      return {
        data: { customQuery: null },
        errors: [{ message: 'No persisted Cypher query found for key', extensions: { code: 'QUERY_NOT_FOUND' } }],
      };
    }

    if (options.fatalCode) {
      return {
        data: { customQuery: null },
        errors: [{ message: 'sandbox failure', extensions: { code: options.fatalCode } }],
      };
    }

    const bundle = pages[queryKey] ?? [];
    const after = variables?.after;
    const index = after == null ? 0 : Number.parseInt(String(after).replace(/\D/g, ''), 10) || 0;
    const page = bundle[index] ?? [];
    const hasNextPage = index + 1 < bundle.length;

    // The real API caps at 25 and filters after paging, so a page can be short
    // and still have more. The sandbox reproduces that on purpose.
    if (!hasNextPage && page.length === 0) {
      return envelope([], null);
    }

    return envelope(
      page,
      options.omitPageInfo ? null : { hasNextPage, endCursor: hasNextPage ? `cursor-${index + 1}` : null },
    );
  }) as RecordedCaller;

  Object.defineProperty(caller, 'calls', {
    get: () => calls,
    enumerable: true,
  });
  caller.totalCalls = (): number => Object.values(calls).reduce((a, b) => a + b, 0);

  return caller;
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const page = (id: string, title: string, createdAt: string): ColumnValue => ({
  __typename: 'CypherQueryResultNode',
  id,
  data: { __typename: 'ConfluencePage', title, webUrl: `https://example.atlassian.net/wiki/${id}`, createdAt },
});

const comment = (id: string, body: string, createdAt: string): ColumnValue => ({
  __typename: 'CypherQueryResultNode',
  id,
  data: { __typename: 'ConfluenceComment', body, createdAt },
});

const build = (id: string, state: string, createdAt: string): ColumnValue => ({
  __typename: 'CypherQueryResultNode',
  id,
  data: { __typename: 'ExternalBuild', state, createdAt },
});

const node = (
  id: string,
  typename: string,
  data: Record<string, unknown>,
): ColumnValue => ({ __typename: 'CypherQueryResultNode', id, data: { __typename: typename, ...data } });

/** A violated decision surfaced as a failing commit status, plus its neighbourhood. */
export const SANDBOX_ATTRIBUTION_PAGES: Record<string, RowSpec[][]> = {
  attribution: [
    [
      {
        build: node('ari:cloud:bitbucket::build/77', 'ExternalBuild', {
          name: 'decision/0031-datastore-monitoring',
          state: 'FAILED',
        }),
        repository: node('ari:cloud:bitbucket::repository/payments', 'ExternalRepository', { name: 'payments' }),
        workItem: node('ari:cloud:jira::issue/CX-11', 'JiraWorkItem', { summary: 'Checkout build failed' }),
        pullRequest: node('ari:cloud:bitbucket::pr/42', 'ExternalPullRequest', { title: 'Add monitoring config' }),
      },
    ],
    [
      {
        build: node('ari:cloud:bitbucket::build/78', 'ExternalBuild', {
          name: 'decision/0012-use-postgres-primary',
          state: 'SUCCESSFUL',
        }),
        deployment: node('ari:cloud:bitbucket::deployment/12', 'ExternalDeployment', { state: 'COMPLETED' }),
      },
    ],
  ],
};

/** A two-page spine, a single-page branch set, and one passing build. */
export const SANDBOX_PAGES: Record<string, RowSpec[][]> = {
  spine: [
    [
      {
        workItem: {
          __typename: 'CypherQueryResultNode',
          id: 'ari:cloud:jira::issue/CX-11',
          data: { __typename: 'JiraWorkItem', key: 'CX-11', summary: 'Checkout build failed' },
        },
        workItemComment: comment('cmt-0', 'we could shard by tenant', '2026-03-11T09:00:00.000Z'),
      },
    ],
    [
      {
        page: page('page-ADR-014', 'ADR-014: keep the billing schema unsharded', '2026-03-12T10:00:00.000Z'),
        build: {
          __typename: 'CypherQueryResultNode',
          id: 'ari:cloud:bitbucket::build/77',
          data: { __typename: 'ExternalBuild', name: 'decision/0031-datastore-monitoring', state: 'FAILED' },
        },
      },
    ],
  ],
  branches: [
    [
      {
        page: page('page-DESIGN', 'Design doc: sharded billing schema', '2026-03-10T09:00:00.000Z'),
        thread: comment('cmt-2', 'range sharding by tenant', '2026-03-10T09:05:00.000Z'),
        replies: {
          __typename: 'CypherQueryResultListNode',
          nodes: [
            { id: 'cmt-3', data: { __typename: 'ConfluenceComment', body: '+1' } },
            { id: 'cmt-4', data: { __typename: 'ConfluenceComment', body: 'works for us' } },
            { id: 'cmt-5', data: { __typename: 'ConfluenceComment', body: 'agreed' } },
          ],
        },
      },
    ],
  ],
  outcomes: [
    [
      {
        build: build('build-77', 'SUCCESSFUL', '2026-09-20T09:00:00.000Z'),
      },
    ],
  ],
};
