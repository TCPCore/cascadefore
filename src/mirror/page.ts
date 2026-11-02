import { stringify } from 'yaml';

import type { Decision, DecisionStatus } from '../decisions/types';

/**
 * Renders a decision as a Confluence page.
 *
 * The page is two layers on purpose:
 *
 *   1. a human summary — status, tests, rationale, readable at a glance;
 *   2. a fenced YAML block — the machine-readable record, byte-identical to the
 *      `.decision` file in the repository.
 *
 * The YAML block is what makes the mirror honest: the page is not a *copy* of
 * the decision that can drift, it is the same document rendered twice. Parsing
 * the page back yields the original decision, which a round-trip test asserts.
 */

export const DECISION_LABEL = 'Decision record';

export function pageTitleFor(id: string): string {
  return `${DECISION_LABEL}: ${id}`;
}

export function idFromTitle(title: string): string | null {
  const prefix = `${DECISION_LABEL}: `;
  return title.startsWith(prefix) ? title.slice(prefix.length) : null;
}

const MARK: Record<string, string> = { enforced: '✓ passed', violated: '✗ failed', orphaned: '— unchecked' };

/** Serialises the specification half of a decision back to `.decision` YAML. */
export function toDecisionYaml(decision: Decision): string {
  const doc: Record<string, unknown> = {
    id: decision.id,
    decision: decision.decision,
    decided_at: decision.decidedAt,
    decided_by: decision.decidedBy,
    domain: decision.domain,
    constraints: decision.constraints,
    rationale: decision.rationale,
    alternatives: decision.alternatives.map((alt) => ({
      name: alt.name,
      ...(alt.rejected_because ? { rejected_because: alt.rejected_because } : {}),
      ...(alt.outcome ? { outcome: alt.outcome } : {}),
    })),
    tests: decision.tests,
    evidence: {
      links: decision.links.map((link) => ({
        type: link.type,
        ...(link.key ? { key: link.key } : {}),
        ...(link.id ? { id: link.id } : {}),
      })),
    },
  };

  return stringify(doc, { lineWidth: 0 });
}

export interface RenderedPage {
  title: string;
  body: string;
}

export function renderDecisionPage(
  decision: Decision,
  status: DecisionStatus = decision.status,
): RenderedPage {
  const runnable = decision.results.filter((r) => !r.skipped);
  const skipped = decision.results.filter((r) => r.skipped);

  const testRows = decision.results.length
    ? decision.results
        .map((result) => {
          const mark = result.skipped ? '—' : result.passed ? '✓' : '✗';
          return `| ${mark} | ${result.name} | ${result.evidence.replace(/\|/g, '\\|')} |`;
        })
        .join('\n')
    : '| — | no tests recorded | — |';

  const body = [
    `# ${DECISION_LABEL}: ${decision.id}`,
    '',
    `**Status:** ${MARK[status] ?? status}  ·  **Decided:** ${decision.decidedAt.slice(0, 10)}  ·  **Domain:** ${decision.domain.join(', ') || '—'}`,
    '',
    `> ${decision.decision}`,
    '',
    '## Why',
    '',
    decision.rationale.trim() || '_No rationale recorded._',
    '',
    '## Tests',
    '',
    `| result | assertion | evidence |`,
    `| --- | --- | --- |`,
    testRows,
    '',
    `_${runnable.length} machine-checkable · ${skipped.length} manual._`,
    '',
    '## Machine-readable record',
    '',
    '<!-- This block is the source of truth. Edit it, not the prose above. -->',
    '',
    '```yaml',
    toDecisionYaml(decision).trimEnd(),
    '```',
    '',
  ].join('\n');

  return { title: pageTitleFor(decision.id), body };
}
