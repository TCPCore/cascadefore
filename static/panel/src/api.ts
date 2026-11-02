import { invoke } from '@forge/bridge';
import type { RunSnapshotDto } from '../../../src/shared/dtos.js';
import type { Horizon } from '../../../src/shared/types.js';

export interface Health {
  demoMode: boolean;
  configured: boolean;
  probeTypes: string[];
}

export interface StartResult {
  runId?: string;
  error?: string;
  message?: string;
}

export async function health(): Promise<Health> {
  try {
    return (await invoke('health')) as Health;
  } catch {
    return { demoMode: false, configured: false, probeTypes: [] };
  }
}

export async function startCascade(input: {
  workItemKey: string;
  intentText: string;
  horizon: Horizon;
}): Promise<StartResult> {
  return (await invoke('startCascade', input)) as StartResult;
}

export async function getRun(runId: string): Promise<{
  snapshot?: RunSnapshotDto;
  error?: string;
  message?: string;
}> {
  return (await invoke('getRun', { runId })) as {
    snapshot?: RunSnapshotDto;
    error?: string;
    message?: string;
  };
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
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return null;
}
