import { isDemoMode } from '../bootstrap';
import { loadConfig } from '../config';

/**
 * Health, as a tool.
 *
 * A caller connecting to an MCP server needs one cheap call that says whether
 * the app is configured for the real graph or running on the seeded one, and
 * whether query keys are present. Without it, every failure looks the same.
 */
export async function healthAction(): Promise<Record<string, unknown>> {
  const config = loadConfig();
  const configured = Boolean(
    config.queryKeys.spine && config.queryKeys.branches && config.queryKeys.outcomes,
  );

  return {
    ok: true,
    demoMode: isDemoMode(),
    configured,
    queryKeys: {
      spine: Boolean(config.queryKeys.spine),
      branches: Boolean(config.queryKeys.branches),
      outcomes: Boolean(config.queryKeys.outcomes),
    },
    probeTypes: config.probeTypes,
    runtime: process.env.FORGE_ENV ?? 'unknown',
    appVersion: process.env.FORGE_APP_VERSION ?? 'unknown',
  };
}
