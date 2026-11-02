import api, { route } from '@forge/api';

import { QUERY_CATALOG, scopesFor, type QuerySpec } from './queries.js';

/**
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
  const response = await api.asUser().requestAtlassian(route`/gateway/api/twg/cypher-queries`, {
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
