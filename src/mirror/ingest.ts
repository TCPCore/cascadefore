import { parseDecision, DecisionParseError } from '../decisions/parse';
import type { Decision } from '../decisions/types';
import { idFromTitle } from './page';

/**
 * Reads decisions back out of the mirrored pages.
 *
 * This is the reverse of `renderDecisionPage`, and it is the reason the mirror
 * can be trusted: the page carries the same YAML the repository does, so
 * ingesting a page yields the decision rather than a paraphrase of it.
 *
 * Status is never ingested — it is computed by running the tests. A document
 * that asserts its own health is the failure mode this design exists to avoid.
 */

export interface SourcePage {
  id: string;
  title: string;
  body: string;
}

export interface IngestResult {
  decisions: Decision[];
  errors: Array<{ id: string; message: string }>;
  ignored: number;
}

export function decisionsFromPages(pages: readonly SourcePage[]): IngestResult {
  const decisions: Decision[] = [];
  const errors: Array<{ id: string; message: string }> = [];
  let ignored = 0;

  for (const page of pages) {
    const id = idFromTitle(page.title);
    if (!id) {
      ignored += 1;
      continue;
    }

    try {
      const decision = parseDecision(page.body);
      // The title is the index; if the body disagrees, the body wins but the
      // mismatch is surfaced rather than silently corrected.
      if (decision.id !== id) {
        errors.push({
          id,
          message: `title says "${id}" but the record says "${decision.id}"`,
        });
        continue;
      }
      decisions.push(decision);
    } catch (error) {
      errors.push({
        id,
        message:
          error instanceof DecisionParseError
            ? `${error.field}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }
  }

  return { decisions, errors, ignored };
}
