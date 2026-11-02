import { QUERY_CATALOG } from './graph/queries';

/**
 * Runtime configuration.
 *
 * Query keys are generated at registration time, so they cannot live in source.
 * They are read from environment variables (simplest for a hackathon) with a
 * documented fallback to the Forge KVS once `registerQueries` has run.
 */
export interface AppConfig {
  queryKeys: { spine: string; branches: string; outcomes: string };
  llmModel: string;
  enableDossier: boolean;
  probeTypes: string[];
}

function env(name: string, fallback = ''): string {
  const value = typeof process !== 'undefined' ? process.env[name] : undefined;
  return value && value.length > 0 ? value : fallback;
}

export function loadConfig(): AppConfig {
  return {
    queryKeys: {
      spine: env('CASCADE_QUERY_SPINE'),
      branches: env('CASCADE_QUERY_BRANCHES'),
      outcomes: env('CASCADE_QUERY_OUTCOMES'),
    },
    llmModel: env('CASCADE_LLM_MODEL', 'sonnet'),
    enableDossier: env('CASCADE_ENABLE_DOSSIER', 'true') !== 'false',
    probeTypes: Array.from(new Set(QUERY_CATALOG.flatMap((q) => q.objectTypes))).slice(0, 8),
  };
}

export function assertConfigured(config: AppConfig): AppConfig {
  const missing = Object.entries(config.queryKeys)
    .filter(([, value]) => !value)
    .map(([key]) => `CASCADE_QUERY_${key.toUpperCase()}`);
  if (missing.length > 0) {
    throw new Error(`Cascade is not configured: missing ${missing.join(', ')}. Run the query registration step.`);
  }
  return config;
}
