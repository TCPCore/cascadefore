import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ExecutorRegistry } from '../decisions/runner';
import type { FileMatchTest, GraphTest, HttpTest } from '../decisions/types';
import type { GraphCaller } from '../graph/client';

/**
 * Host executors for the CI runner.
 *
 * These are the kinds a repository-side runner can actually satisfy:
 *
 *   file_match → reads the checked-out repo
 *   http       → fetches a URL
 *   graph      → runs a persisted Cypher assertion through Teamwork Graph
 *
 * `shell` deliberately has no executor: the runner is a pipeline step, so shell
 * belongs in the pipeline step itself, not behind a test kind.
 */

export interface ExecutorOptions {
  /** Repository root for file_match targets. */
  root: string;
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** Teamwork Graph caller for graph assertions. */
  graph?: GraphCaller;
  /** Maps a decision test's `cypher_key` to a registered query key. */
  queryKeys?: Record<string, string>;
}

export function createHostExecutors(options: ExecutorOptions): ExecutorRegistry {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    file_match: async (test) => {
      const fileTest = test as FileMatchTest;
      let contents: string;
      try {
        contents = await readFile(join(options.root, fileTest.target), 'utf8');
      } catch {
        return { passed: false, evidence: `file not found: ${fileTest.target}` };
      }

      let pattern: RegExp;
      try {
        pattern = new RegExp(fileTest.pattern);
      } catch {
        return { passed: false, evidence: `invalid pattern: ${fileTest.pattern}` };
      }

      const passed = pattern.test(contents);
      return {
        passed,
        evidence: passed
          ? `matched /${fileTest.pattern}/ in ${fileTest.target}`
          : `no match for /${fileTest.pattern}/ in ${fileTest.target}`,
      };
    },

    http: async (test) => {
      const httpTest = test as HttpTest;
      try {
        const response = await doFetch(httpTest.url);
        const expectedStatus = httpTest.expect_status ?? 200;
        if (response.status !== expectedStatus) {
          return { passed: false, evidence: `expected ${expectedStatus}, got ${response.status}` };
        }
        if (httpTest.expect_body) {
          const body = await response.text();
          const passed = body.includes(httpTest.expect_body);
          return {
            passed,
            evidence: passed
              ? `${httpTest.url} contained "${httpTest.expect_body}"`
              : `${httpTest.url} did not contain "${httpTest.expect_body}"`,
          };
        }
        return { passed: true, evidence: `${httpTest.url} returned ${response.status}` };
      } catch (error) {
        return {
          passed: false,
          evidence: `request failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    graph: async (test) => {
      const graphTest = test as GraphTest;
      if (!options.graph) {
        return { passed: false, evidence: 'no Teamwork Graph caller configured' };
      }
      const queryKey = options.queryKeys?.[graphTest.cypher_key] ?? graphTest.cypher_key;

      try {
        const response = await options.graph(
          `query Cascade_assertion($queryKey: String!, $queryParams: CypherRequestParams) {
             customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 1) {
               edges { node { columns { key value { __typename } } } }
             }
           }`,
          { queryKey, queryParams: graphTest.params },
        );

        if (response.errors?.length) {
          return { passed: false, evidence: `graph error: ${response.errors[0]?.message ?? 'unknown'}` };
        }

        const data = response.data as { customQuery?: { edges?: unknown[] } } | undefined;
        const rows = data?.customQuery?.edges?.length ?? 0;
        const expected = graphTest.expect;

        if (typeof expected === 'number') {
          const passed = rows === expected;
          return { passed, evidence: `expected ${expected} row(s), saw ${rows}` };
        }
        if (typeof expected === 'boolean') {
          const passed = expected ? rows > 0 : rows === 0;
          return { passed, evidence: `expected ${expected ? 'rows' : 'no rows'}, saw ${rows}` };
        }
        return { passed: rows > 0, evidence: `saw ${rows} row(s)` };
      } catch (error) {
        return {
          passed: false,
          evidence: `graph call failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
