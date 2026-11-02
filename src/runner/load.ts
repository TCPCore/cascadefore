import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { parseDecision, DecisionParseError } from '../decisions/parse';
import type { Decision } from '../decisions/types';

/**
 * Reads a `.decisions/` directory.
 *
 * A malformed file must never stop the run: the point of the runner is to tell
 * you everything that is wrong, not to fail on the first thing. Parse errors are
 * collected and reported alongside the decisions that did load.
 */

export const DECISION_EXTENSION = '.decision';

export interface LoadedDecision {
  path: string;
  decision: Decision | null;
  error: string | null;
}

export interface LoadResult {
  decisions: Decision[];
  errors: Array<{ path: string; message: string }>;
  loaded: LoadedDecision[];
}

export async function loadDecisionDirectory(dir: string): Promise<LoadResult> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { decisions: [], errors: [{ path: dir, message: 'directory not found' }], loaded: [] };
  }

  const files = entries.filter((name) => name.endsWith(DECISION_EXTENSION)).sort();
  const loaded: LoadedDecision[] = [];
  const decisions: Decision[] = [];
  const errors: Array<{ path: string; message: string }> = [];

  for (const name of files) {
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) continue;

    const source = await readFile(path, 'utf8');
    try {
      const decision = parseDecision(source);
      decisions.push(decision);
      loaded.push({ path, decision, error: null });
    } catch (error) {
      const message =
        error instanceof DecisionParseError
          ? `${error.field}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      errors.push({ path, message });
      loaded.push({ path, decision: null, error: message });
    }
  }

  return { decisions, errors, loaded };
}
