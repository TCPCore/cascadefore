import { parse as parseYaml } from 'yaml';

import type {
  Alternative,
  Decision,
  DecisionTest,
  EvidenceLink,
  TestKind,
} from './types';

/**
 * Parses a `.decision` document.
 *
 * The same text is accepted from a repository file or from a fenced YAML block
 * inside a Confluence page, which is what lets one parser serve both hosting
 * architectures.
 *
 * `status`, `results` and `last_run_at` are deliberately ignored if present:
 * status is computed, never authored. A document that asserts its own health is
 * exactly the failure mode this design exists to avoid.
 */

const TEST_KINDS: TestKind[] = ['file_match', 'shell', 'http', 'graph', 'manual'];

export class DecisionParseError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'DecisionParseError';
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function requireString(doc: Record<string, unknown>, field: string): string {
  const value = doc[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DecisionParseError(`missing required field "${field}"`, field);
  }
  return value.trim();
}

function parseAlternative(raw: unknown, index: number): Alternative {
  if (typeof raw === 'string') return { name: raw };
  if (!raw || typeof raw !== 'object') {
    throw new DecisionParseError(`alternatives[${index}] is not an object`, 'alternatives');
  }
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : `alternative ${index + 1}`;
  const outcome = record.outcome;
  return {
    name,
    ...(typeof record.rejected_because === 'string' ? { rejected_because: record.rejected_because } : {}),
    ...(outcome === 'never_tried' || outcome === 'unknown' || outcome === 'tried_ok' || outcome === 'tried_bad'
      ? { outcome }
      : {}),
  };
}

function parseTest(raw: unknown, index: number): DecisionTest {
  if (!raw || typeof raw !== 'object') {
    throw new DecisionParseError(`tests[${index}] is not an object`, 'tests');
  }
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== 'string' || !TEST_KINDS.includes(kind as TestKind)) {
    throw new DecisionParseError(
      `tests[${index}].kind must be one of ${TEST_KINDS.join(', ')}`,
      'tests',
    );
  }
  const name = typeof record.name === 'string' ? record.name : `${kind} test ${index + 1}`;

  switch (kind as TestKind) {
    case 'file_match':
      return {
        kind: 'file_match',
        name,
        target: requireString(record, 'target'),
        pattern: requireString(record, 'pattern'),
        ...(typeof record.on_fail === 'string' ? { on_fail: record.on_fail } : {}),
      };
    case 'shell':
      return {
        kind: 'shell',
        name,
        command: requireString(record, 'command'),
        expected: typeof record.expected === 'string' ? record.expected : '',
        ...(typeof record.timeout_s === 'number' ? { timeout_s: record.timeout_s } : {}),
      };
    case 'http':
      return {
        kind: 'http',
        name,
        url: requireString(record, 'url'),
        ...(typeof record.expect_status === 'number' ? { expect_status: record.expect_status } : {}),
        ...(typeof record.expect_body === 'string' ? { expect_body: record.expect_body } : {}),
      };
    case 'graph':
      return {
        kind: 'graph',
        name,
        cypher_key: requireString(record, 'cypher_key'),
        params:
          record.params && typeof record.params === 'object'
            ? (record.params as Record<string, unknown>)
            : {},
        expect: record.expect,
      };
    case 'manual':
    default:
      return {
        kind: 'manual',
        name,
        note: typeof record.note === 'string' ? record.note : '',
      };
  }
}

function parseLink(raw: unknown): EvidenceLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const type = record.type;
  if (type !== 'jira_issue' && type !== 'confluence_page' && type !== 'bitbucket_pr') return null;
  return {
    type,
    ...(typeof record.key === 'string' ? { key: record.key } : {}),
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
  };
}

/** Extracts the first fenced yaml block from a page body, if any. */
export function extractDecisionBlock(body: string): string {
  const fenced = /```ya?ml\s*\n([\s\S]*?)```/i.exec(body);
  return fenced?.[1] ?? body;
}

export function parseDecision(source: string): Decision {
  const text = extractDecisionBlock(source);

  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (error) {
    throw new DecisionParseError(
      `not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      'yaml',
    );
  }
  if (!doc || typeof doc !== 'object') {
    throw new DecisionParseError('document did not parse to an object', 'yaml');
  }

  const record = doc as Record<string, unknown>;
  const id = requireString(record, 'id');
  const decision = requireString(record, 'decision');
  const decidedAtRaw = record.decided_at;
  if (typeof decidedAtRaw !== 'string' || Number.isNaN(Date.parse(decidedAtRaw))) {
    throw new DecisionParseError('decided_at must be an ISO timestamp', 'decided_at');
  }

  const tests = Array.isArray(record.tests) ? record.tests.map(parseTest) : [];
  const alternatives = Array.isArray(record.alternatives)
    ? record.alternatives.map(parseAlternative)
    : [];
  const linksRaw =
    record.evidence && typeof record.evidence === 'object'
      ? (record.evidence as Record<string, unknown>).links
      : undefined;
  const links = Array.isArray(linksRaw)
    ? linksRaw.map(parseLink).filter((l): l is EvidenceLink => l !== null)
    : [];

  return {
    id,
    decision,
    decidedAt: new Date(decidedAtRaw).toISOString(),
    decidedBy: asStringArray(record.decided_by),
    domain: asStringArray(record.domain),
    constraints: asStringArray(record.constraints),
    rationale: typeof record.rationale === 'string' ? record.rationale : '',
    alternatives,
    tests,
    links,
    status: 'unknown',
    results: [],
    lastRunAt: null,
  };
}

/** Parses a directory-style bundle: one decision per document, in order. */
export function parseDecisionBundle(documents: readonly string[]): Decision[] {
  return documents.map(parseDecision);
}
