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
export interface DecisionRow {
  id: string;
  decision: string;
  status: 'enforced' | 'violated' | 'orphaned' | 'unknown';
  decidedAt: string;
  domain: string[];
  constraints: string[];
  rationale: string;
  passed: number;
  failed: number;
  skipped: number;
  results: Array<{ name: string; kind: string; passed: boolean; skipped: boolean; evidence: string; onFail?: string }>;
}

export interface PatternRow {
  id: string;
  patternText: string;
  domain: string[];
  constraints: string[];
  evidenceDecisionIds: string[];
  confidence: number;
  confirmations: number;
  refutations: number;
}

export interface GrowthPointRow {
  n: number;
  patternCount: number;
  top: { id: string; confidence: number; confirmations: number; refutations: number } | null;
}

export interface DecisionReport {
  decisions: DecisionRow[];
  patterns: PatternRow[];
  growth: GrowthPointRow[];
  counts: Record<string, number>;
  testability: { rate: number; testable: number; total: number };
  generatedAt: string;
}

export interface SimilarRow {
  id: string;
  decision: string;
  status: string;
  score: number;
  because: string[];
}

export interface AttributionEventRow {
  kind: 'build' | 'repository' | 'work-item' | 'pull-request' | 'deployment';
  ari: string;
  title: string;
  state?: string;
  decisionId?: string;
}

export interface AttributionSummary {
  decisions: string[];
  builds: number;
  workItems: number;
  pullRequests: number;
  deployments: number;
  failedBuilds: number;
  events: AttributionEventRow[];
}

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
async function bridgeInvoke<T>(key: string, payload?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@forge/bridge');
  return (await invoke(key, payload as never)) as T;
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
  eventKind?: string;
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

export interface TimelineEntryRow {
  at: string;
  kind: string;
  title: string;
  ari: string | null;
  knowableAtAnchor: boolean;
}

export interface CounterfactualRow {
  name: string;
  rejectedBecause: string | null;
  knownThen: Array<{ decisionId: string; title: string; outcome: string }>;
  learnedLater: Array<{ decisionId: string; title: string; outcome: string }>;
  summary: string;
}

export interface RunView {
  snapshot?: RunSnapshotDto;
  timeline?: {
    summary: string;
    knowableThen: number;
    learnedSince: number;
    entries: TimelineEntryRow[];
  };
  counterfactuals?: CounterfactualRow[];
  forecast?: Array<{
    branchId: string;
    label: string;
    probability: number;
    interval: [number, number];
    grade: string;
    baseRate: number;
    evidenceCount: number;
    caveat: string | null;
  }>;
  error?: string;
  message?: string;
}

export async function getRun(runId: string): Promise<RunView> {
  if (standalone) {
    return jsonFetch(`/api/runs/${encodeURIComponent(runId)}`);
  }
  return await bridgeInvoke<RunView>('getRun', { runId });
}

export async function getDecisionReport(): Promise<DecisionReport | null> {
  if (standalone) {
    try {
      return await jsonFetch<DecisionReport>('/api/decisions');
    } catch {
      return null;
    }
  }
  try {
    return await bridgeInvoke<DecisionReport>('decisionReport');
  } catch {
    return null;
  }
}

export async function getSimilar(id: string): Promise<SimilarRow[]> {
  if (standalone) {
    try {
      const result = await jsonFetch<{ similar: SimilarRow[] }>(
        `/api/decisions/similar?id=${encodeURIComponent(id)}`,
      );
      return result.similar;
    } catch {
      return [];
    }
  }
  try {
    const result = await bridgeInvoke<{ similar: SimilarRow[] }>('similarDecisions', { id });
    return result.similar;
  } catch {
    return [];
  }
}

export async function getAttribution(): Promise<AttributionSummary | null> {
  if (standalone) {
    try {
      const result = await jsonFetch<{ summary: AttributionSummary }>('/api/attribution');
      return result.summary;
    } catch {
      return null;
    }
  }
  try {
    return await bridgeInvoke<AttributionSummary>('attribution');
  } catch {
    return null;
  }
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
