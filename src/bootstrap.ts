import api from '@forge/api';
import { Queue } from '@forge/events';
import { chat } from '@forge/llm';

import { loadConfig, type AppConfig } from './config';
import type { ChatFn } from './llm/intentParser';
import { parseIntent } from './llm/intentParser';
import type { GraphCaller, GraphResponse } from './graph/client';
import { createGraphSource } from './graph/source';
import { createDemoSource } from './demo/seedSource';
import type { GraphSource, PipelineDeps } from './pipeline/run';
import { forgeSqlDriver } from './storage/forgeDriver';
import { RunRepository } from './storage/runs';

export const QUEUE_KEY = 'cascade-jobs';

/** Teamwork Graph is called as the acting user, never as the app. */
export function forgeGraphCaller(): GraphCaller {
  return async (query: string, variables?: Record<string, unknown>): Promise<GraphResponse> => {
    const response = await api.asUser().requestTeamworkGraph(query, variables ?? {});
    return (await response.json()) as GraphResponse;
  };
}

function forgeChat(): ChatFn {
  return async ({ model, messages, temperature }) => {
    // The LlmRequest shape is narrower than our message union; the cast is
    // confined to this adapter on purpose.
    const response = await chat({
      model,
      messages: messages as never,
      temperature,
    } as never);
    const content = (response as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
      ?.message?.content;
    return typeof content === 'string' ? content : '';
  };
}

export function isDemoMode(): boolean {
  return process.env.CASCADE_DEMO_MODE === 'true';
}

export function buildSource(config: AppConfig): GraphSource {
  if (isDemoMode()) return createDemoSource();
  return createGraphSource(forgeGraphCaller(), config.queryKeys, {
    now: () => new Date().toISOString(),
    probeTypes: config.probeTypes,
  });
}

export function buildDeps(config: AppConfig = loadConfig()): PipelineDeps {
  return {
    source: buildSource(config),
    parseIntent: (text, horizon) =>
      parseIntent(text, horizon, { model: config.llmModel, chat: forgeChat() }),
    now: () => new Date().toISOString(),
  };
}

export function repository(): RunRepository {
  return new RunRepository(forgeSqlDriver);
}

export function jobQueue(): Queue<Record<string, unknown>> {
  return new Queue<Record<string, unknown>>({ key: QUEUE_KEY });
}
