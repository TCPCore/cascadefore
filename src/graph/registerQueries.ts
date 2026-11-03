import api, { route } from '@forge/api';

import { QUERY_CATALOG, scopesFor, type QuerySpec } from './queries';

/**
 * NOT WIRED — kept for the UI context that does not exist yet.
 *
 * Registration needs a *user* contributor: as the app it returns 401, and over
 * MCP `asUser()` cannot obtain graph scopes because the gateway does not support
 * them. Today the queries are registered by hand in TWG Labs
 * (see docs/queries-for-twg-labs.md), and the keys are set as app variables.
 *
 * Wire this to a resolver once the Jira panel is confirmed to mount; at that
 * point the resolver has the user session registration needs.
 *
 * Registers every persisted Cypher query against this app and returns the keys.
 *
 * Registration is idempotent on query text: resubmitting identical Cypher
 * returns 200 with the original key rather than creating a duplicate, so this
 * is safe to run on every deploy.
 *
 * Run it once per site:
 *   forge invoke --function register-queries
 *
 * Then put the returned keys into the app environment:
 *   CASCADE_QUERY_SPINE / _BRANCHES / _OUTCOMES
 */

interface RegistrationResponse {
  queryKey?: string;
  version?: number;
  status?: string;
  errors?: Array<{ code?: string; message?: string }>;
}

export interface RegistrationResult {
  key: string;
  queryKey: string | null;
  status: string;
  message: string;
}

function appIdFromEnv(): string {
  const id = process.env.FORGE_APP_ID ?? process.env.CASCADE_APP_ID ?? '';
  return id;
}

async function registerOne(spec: QuerySpec, appId: string): Promise<RegistrationResult> {
  // App identity: the app owns the queries and already holds the graph scopes,
  // so registration does not need a per-user outbound consent round trip.
  // `/gateway/...` is a site-relative path, so it has to go through a product
  // client (which targets the site root) rather than the Atlassian API client.
  // Registration is a contributor action, so it must run as the user. The
  // product client carries the user's site session, which is why this works
  // without a separate outbound-consent round trip.
  const response = await api.asUser().requestJira(route`/gateway/api/twg/cypher-queries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId,
      name: spec.name,
      cypher: spec.cypher,
      paramsSchema: [],
    }),
  });

  const body = (await response.json()) as RegistrationResponse;
  const firstError = body.errors?.[0];

  return {
    key: spec.key,
    queryKey: body.queryKey ?? null,
    status: String(response.status),
    message: firstError?.message ?? body.status ?? 'ok',
  };
}

export async function registerQueriesHandler(): Promise<{
  results: RegistrationResult[];
  scopes: Record<string, string[]>;
  env: Record<string, string>;
}> {
  const appId = appIdFromEnv();
  if (!appId) {
    throw new Error('FORGE_APP_ID is not set in the app environment.');
  }

  const results: RegistrationResult[] = [];
  for (const spec of QUERY_CATALOG) {
    results.push(await registerOne(spec, appId));
  }

  const env: Record<string, string> = {};
  for (const result of results) {
    if (result.queryKey) env[`CASCADE_QUERY_${result.key.toUpperCase()}`] = result.queryKey;
  }

  const scopes: Record<string, string[]> = {};
  for (const spec of QUERY_CATALOG) scopes[spec.key] = scopesFor(spec);

  return { results, scopes, env };
}

/**
 * The keys must propagate to execution regions for about a minute after
 * registration. Calling `customQuery` too early returns QUERY_NOT_FOUND, which
 * the transport treats as retryable — so a first run immediately after
 * registration is expected to be slow, not broken.
 */
export const REGISTRATION_PROPAGATION_MS = 60_000;
