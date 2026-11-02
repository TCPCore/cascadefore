import type { Iso } from '../shared/types';

/**
 * Decision as Assertion.
 *
 * A decision is not a document with a date on it. It is a claim about the
 * system that carries its own means of being checked, and a status that is
 * computed rather than written.
 *
 * The `.decision` file keeps the same shape whether it lives in a repository or
 * in a Confluence page body, because the parsing layer is the only thing that
 * knows the difference.
 */

export type DecisionStatus = 'enforced' | 'violated' | 'orphaned' | 'unknown';

export type TestKind = 'file_match' | 'shell' | 'http' | 'graph' | 'manual';

export interface FileMatchTest {
  kind: 'file_match';
  name: string;
  target: string;
  pattern: string;
  on_fail?: string;
}

export interface ShellTest {
  kind: 'shell';
  name: string;
  command: string;
  expected: string;
  timeout_s?: number;
}

export interface HttpTest {
  kind: 'http';
  name: string;
  url: string;
  expect_status?: number;
  expect_body?: string;
}

export interface GraphTest {
  kind: 'graph';
  name: string;
  cypher_key: string;
  params: Record<string, unknown>;
  expect: unknown;
}

export interface ManualTest {
  kind: 'manual';
  name: string;
  note: string;
}

export type DecisionTest = FileMatchTest | ShellTest | HttpTest | GraphTest | ManualTest;

export interface Alternative {
  name: string;
  rejected_because?: string;
  outcome?: 'never_tried' | 'unknown' | 'tried_ok' | 'tried_bad';
}

export interface EvidenceLink {
  type: 'jira_issue' | 'confluence_page' | 'bitbucket_pr';
  key?: string;
  id?: string;
}

export interface Decision {
  id: string;
  decision: string;
  decidedAt: Iso;
  decidedBy: string[];
  domain: string[];
  constraints: string[];
  rationale: string;
  alternatives: Alternative[];
  tests: DecisionTest[];
  links: EvidenceLink[];
  /** Computed by the runner. Never authored. */
  status: DecisionStatus;
  /** Computed by the runner. Empty until the tests have run. */
  results: TestResult[];
  lastRunAt: Iso | null;
}

export interface TestResult {
  name: string;
  kind: TestKind;
  passed: boolean;
  /** true when no executor is configured for this kind in this host. */
  skipped: boolean;
  durationMs: number;
  evidence: string;
  onFail?: string;
}

export interface DecisionContext {
  domain: string[];
  constraints: string[];
  terms: string[];
  decisionType: 'choice' | 'constraint' | 'deferral' | 'reversal';
}

export interface SimilarDecision {
  decision: Decision;
  score: number;
  /** Human-readable reasons: "shared constraint #acid-required". */
  because: string[];
}

export interface Pattern {
  id: string;
  patternText: string;
  domain: string[];
  constraints: string[];
  evidenceDecisionIds: string[];
  confidence: number;
  confirmations: number;
  refutations: number;
}
