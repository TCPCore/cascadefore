/**
 * Teamwork Graph transport.
 *
 * Two responsibilities only:
 *  1. Page through `customQuery` results correctly. The API caps `first` at 25
 *     and filters by permission *after* paging, so a page may return fewer rows
 *     than requested while still having more. Loops are driven by `hasNextPage`,
 *     never by row count.
 *  2. Classify errors into retryable vs fatal. `QUERY_NOT_FOUND` is expected for
 *     ~1 minute after registration and is not a failure.
 */

export interface GraphError {
  message: string;
  extensions?: { code?: string };
}

export interface GraphResponse {
  data?: unknown;
  errors?: GraphError[];
}

export type GraphCaller = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<GraphResponse>;

export interface PageResult<T> {
  rows: T[];
  pages: number;
  truncated: boolean;
  errorCode: string | null;
}

export const PAGE_SIZE = 25;
const DEFAULT_MAX_PAGES = 20;

export function errorCodeOf(errors: readonly GraphError[] | undefined): string | null {
  if (!errors || errors.length === 0) return null;
  for (const e of errors) {
    const code = e.extensions?.code;
    if (code) return code;
  }
  return 'GRAPH_ERROR';
}

export function isRetryable(code: string | null): boolean {
  return code === 'QUERY_NOT_FOUND';
}

export function isFatalScopeError(code: string | null): boolean {
  return code === 'NOT_OWNER' || code === 'INSTALLATION_NOT_FOUND' || code === 'FEATURE_UNAVAILABLE';
}

/** GraphQL envelope for a persisted query. `customQuery` takes a key, not Cypher. */
export function buildCustomQueryDocument(): string {
  return `query Cascade_customQuery($queryKey: String!, $queryParams: CypherRequestParams, $first: Int, $after: String) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: $first, after: $after) {
    edges {
      node {
        columns {
          key
          value {
            __typename
            ... on CypherQueryResultNode {
              id
              data {
                __typename
                ... on JiraWorkItem { key summary createdAt }
                ... on ConfluencePage { title webUrl createdAt }
                ... on ConfluenceComment { body createdAt }
                ... on AtlassianUser { accountId name }
              }
            }
            ... on CypherQueryResultListNode { nodes { id } }
            ... on CypherQueryResultStringObject { value }
            ... on CypherQueryResultIntObject { value }
            ... on CypherQueryResultFloatObject { value }
            ... on CypherQueryResultBooleanObject { value }
            ... on CypherQueryResultTimestampObject { value }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
}

/** Raw Cypher envelope, used only by the scope probe (no registration needed). */
export function buildRawCypherDocument(): string {
  return `query Cascade_cypher($cypherQuery: String!, $params: CypherRequestParams) {
  cypherQuery(query: $cypherQuery, params: $params) {
    edges { node { columns { key value { __typename } } } }
  }
}`;
}

interface RawEdge {
  node?: {
    columns?: Array<{ key: string; value: Record<string, unknown> | null }>;
  };
}

export interface RawRow {
  columns: Record<string, Record<string, unknown> | null>;
}

/** Flattens `edges[].node.columns[]` into one object per row. */
export function rowsFromResponse(data: unknown): { rows: RawRow[]; hasNextPage: boolean; endCursor: string | null } {
  const conn = (data as { customQuery?: { edges?: RawEdge[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } })
    ?.customQuery;
  const edges = conn?.edges ?? [];
  const rows: RawRow[] = edges.map((edge) => {
    const columns: Record<string, Record<string, unknown> | null> = {};
    for (const col of edge.node?.columns ?? []) {
      columns[col.key] = col.value;
    }
    return { columns };
  });
  return {
    rows,
    hasNextPage: Boolean(conn?.pageInfo?.hasNextPage),
    endCursor: conn?.pageInfo?.endCursor ?? null,
  };
}

export interface RunQueryOptions {
  maxPages?: number;
  sleep?: (ms: number) => Promise<void>;
  registrationRetries?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes a persisted query, following cursors until exhausted.
 * `mapPage` converts one page of raw rows into domain rows; failures inside it
 * are the caller's problem, not the transport's.
 */
export async function runPersistedQuery<T>(
  caller: GraphCaller,
  queryKey: string,
  params: Record<string, unknown>,
  mapPage: (rows: RawRow[]) => T[],
  options: RunQueryOptions = {},
): Promise<PageResult<T>> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const sleep = options.sleep ?? defaultSleep;
  const registrationRetries = options.registrationRetries ?? 3;
  const document = buildCustomQueryDocument();

  const all: T[] = [];
  let after: string | null = null;
  let pages = 0;
  let registrationAttempts = 0;

  while (pages < maxPages) {
    const response = await caller(document, {
      queryKey,
      queryParams: params,
      first: PAGE_SIZE,
      after,
    });

    const code = errorCodeOf(response.errors);
    if (code) {
      if (isRetryable(code) && registrationAttempts < registrationRetries) {
        registrationAttempts += 1;
        await sleep(2000 * registrationAttempts);
        continue;
      }
      return { rows: all, pages, truncated: false, errorCode: code };
    }

    const { rows, hasNextPage, endCursor } = rowsFromResponse(response.data);
    all.push(...mapPage(rows));
    pages += 1;

    if (!hasNextPage || !endCursor) {
      return { rows: all, pages, truncated: false, errorCode: null };
    }
    after = endCursor;
  }

  return { rows: all, pages, truncated: true, errorCode: null };
}
