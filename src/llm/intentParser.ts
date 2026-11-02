import type { Horizon, Intent } from '../shared/types';
import { normaliseIntent, parseIntentLocally } from '../domain/intent';

/**
 * Intent parsing is the *only* place a model is allowed, and it is sandboxed:
 *
 *  - it may only restructure what the user already wrote;
 *  - any hard constraint that is not literally grounded in the input text is
 *    dropped, because constraints become vetoes and a hallucinated veto would
 *    silently hide a valid path;
 *  - any failure falls back to the deterministic parser.
 *
 * The model never sees the graph, never sees a score, and never selects a path.
 */

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export type ChatFn = (args: { model: string; messages: ChatMessage[]; temperature?: number }) => Promise<string>;

export interface IntentParseDeps {
  chat?: ChatFn;
  model: string;
}

const SYSTEM_PROMPT = `You convert a Jira user's plain-language goal into a JSON object.
Return ONLY JSON with this shape:
{"goal":string,"successCriteria":string[],"hardConstraints":string[],"softPreferences":string[],"nonGoals":string[]}
Rules:
- Copy the user's own wording. Do not invent requirements.
- hardConstraints are only things stated as MUST / MUST NOT / CANNOT / WITHOUT.
- If the user said nothing for a field, return an empty array.
- Never add a constraint that is not in the text.`;

export function buildIntentPrompt(text: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: text },
  ];
}

/** Tolerant JSON extraction: models wrap JSON in prose or fences. */
export function extractJson(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normaliseForGrounding(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Keeps only constraints whose text actually appears in the user's input.
 * This is the guardrail that makes hard-constraint vetoes trustworthy.
 */
export function filterGroundedConstraints(original: string, constraints: readonly string[]): string[] {
  const haystack = normaliseForGrounding(original);
  return constraints.filter((c) => {
    const needle = normaliseForGrounding(c);
    if (needle.length === 0) return false;
    if (haystack.includes(needle)) return true;
    // Allow the model to trim a trailing tag or punctuation, but not to add words.
    const words = needle.replace(/#[a-z0-9-]+/g, '').trim();
    return words.length > 0 && haystack.includes(words);
  });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
}

export async function parseIntent(
  text: string,
  horizon: Horizon | undefined,
  deps: IntentParseDeps,
): Promise<Intent> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ...parseIntentLocally('', horizon), source: 'inferred' };
  }

  const local = parseIntentLocally(trimmed, horizon);

  if (!deps.chat) return local;

  try {
    const raw = await deps.chat({
      model: deps.model,
      messages: buildIntentPrompt(trimmed),
      temperature: 0,
    });
    const json = extractJson(raw);
    if (!json) return local;

    const parsed = normaliseIntent(
      {
        goal: typeof json.goal === 'string' ? json.goal : local.goal,
        successCriteria: asStringArray(json.successCriteria),
        hardConstraints: filterGroundedConstraints(trimmed, asStringArray(json.hardConstraints)),
        softPreferences: asStringArray(json.softPreferences),
        nonGoals: asStringArray(json.nonGoals),
        horizon: horizon ?? local.horizon,
        source: 'user',
      },
      'user',
    );

    // If the model dropped everything, the deterministic parse is still better.
    if (parsed.hardConstraints.length === 0 && local.hardConstraints.length > 0) {
      return { ...parsed, hardConstraints: local.hardConstraints };
    }
    return parsed;
  } catch {
    return local;
  }
}

/** Adapter for the real Forge LLM client. Kept out of tests. */
export function forgeChatAdapter(chatFn: (prompt: unknown) => Promise<{ choices: Array<{ message: { content: unknown } }> }>): ChatFn {
  return async ({ model, messages, temperature }) => {
    const response = await chatFn({ model, messages, temperature });
    const content = response.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  };
}
