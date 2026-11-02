import type { RunSnapshotDto } from '../../../src/shared/dtos';
import type { Horizon } from '../../../src/shared/types';

declare const __STANDALONE__: boolean;

/**
 * One API surface, two hosts.
 *
 *  - inside Jira:  the Forge bridge (`invoke`)
 *  - standalone:   plain HTTP against the local host in scripts/serve.ts
 *
 * Everything above this file is host-agnostic, which is why the same components
 * render in both places.
 */
export interface Health {
  demoMode: boolean;
  configured: boolean;
  probeTypes: string[];
  workItemKey?: string;
}

export interface StartResult {
  runId?: string;
  error?: string;
  message?: string;
}

export const isStandalone = typeof __STANDALONE__ !== 'undefined' && __STANDALONE__;
const standalone = isStandalone;

/**
 * The bridge is imported lazily so that a plain browser never evaluates a
 * module that expects to run inside an Atlassian iframe.
 */
async function bridgeInvoke<T>(key: string, payload?: unknown): Promise<T> {
  const { invoke } = await import('@forge/bridge');
  return (await invoke(key, payload)) as T;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

export async function health(): Promise<Health> {
  if (standalone) {
    try {
      return await jsonFetch<Health>('/api/health');
    } catch {
      return { demoMode: true, configured: true, probeTypes: [], workItemKey: 'CX-11' };
    }
  }
  try {
    return await bridgeInvoke<Health>('health');
  } catch {
    return { demoMode: false, configured: false, probeTypes: [] };
  }
}

export async function startCascade(input: {
  workItemKey: string;
  intentText: string;
  horizon: Horizon;
}): Promise<StartResult> {
  if (standalone) {
    try {
      return await jsonFetch<StartResult>('/api/runs', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    } catch (error) {
      return { error: 'REQUEST_FAILED', message: error instanceof Error ? error.message : 'request failed' };
    }
  }
  return await bridgeInvoke<StartResult>('startCascade', input);
}

export async function getRun(runId: string): Promise<{
  snapshot?: RunSnapshotDto;
  error?: string;
  message?: string;
}> {
  if (standalone) {
    return jsonFetch(`/api/runs/${encodeURIComponent(runId)}`);
  }
  return await bridgeInvoke<{ snapshot?: RunSnapshotDto; error?: string; message?: string }>('getRun', { runId });
}

export async function waitForRun(
  runId: string,
  onTick: (snapshot: RunSnapshotDto) => void,
  timeoutMs = 60_000,
): Promise<RunSnapshotDto | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await getRun(runId);
    if (result.snapshot) {
      onTick(result.snapshot);
      if (result.snapshot.status !== 'running' && result.snapshot.status !== 'queued') {
        return result.snapshot;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return null;
}
