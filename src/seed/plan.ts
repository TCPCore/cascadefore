/**
 * Demo seeding — the plan.
 *
 * A cold install has no ADRs, no decision pages and no failing work item, so a
 * judge sees an empty graph and an empty state. This module *plans* the scene;
 * `apply.ts` executes it through an injected client.
 *
 * Planning is separated from execution for one reason: the plan is testable
 * without a site. Every operation id is derived from stable content, so
 * re-running the seeder is idempotent — the same plan, minus whatever already
 * exists.
 */

export type SeedOperation =
  | {
      kind: 'createPage';
      /** Stable, title-based key used for idempotency. */
      opId: string;
      spaceKey: string;
      title: string;
      body: string;
    }
  | {
      kind: 'createIssue';
      opId: string;
      projectKey: string;
      summary: string;
      description: string;
      issueType: string;
    }
  | {
      kind: 'addComment';
      opId: string;
      /** Issue key or page title the comment attaches to. */
      targetRef: string;
      targetKind: 'issue' | 'page';
      body: string;
    };

export interface SeedPlanInput {
  spaceKey: string;
  projectKey: string;
  /** Titles/pages that already exist, to keep the plan idempotent. */
  existingTitles?: readonly string[];
  existingIssueSummaries?: readonly string[];
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

const ADR_OPTIONS = (resolution: string): string =>
  [
    '## Options considered',
    '',
    '1. Range-shard by tenant — removes the cross-tenant lock, two-week migration.',
    '2. Keep a single schema — no migration, but every write serialises on one table.',
    '',
    '## Decision outcome',
    '',
    resolution,
    '',
  ].join('\n');

/**
 * The scene mirrors `examples/decision-repo`, so what the seeder creates is the
 * same story the decision files describe. That consistency matters: the demo
 * shows a real graph, not a different one.
 */
export function planSeed(input: SeedPlanInput): SeedOperation[] {
  const existingTitles = new Set((input.existingTitles ?? []).map((t) => t.toLowerCase()));
  const existingSummaries = new Set(
    (input.existingIssueSummaries ?? []).map((s) => s.toLowerCase()),
  );
  const operations: SeedOperation[] = [];

  const pages: Array<{ title: string; body: string }> = [
    {
      title: 'ADR-003: region-scoped single tenant schema',
      body: `# ADR-003\n\n${ADR_OPTIONS('Adopted per-region schemas.')}`,
    },
    {
      title: 'Design doc: sharded billing schema',
      body: `# Design doc — sharded billing schema\n\n${ADR_OPTIONS('Proposed range sharding; not adopted at the time.')}`,
    },
    {
      title: 'ADR-014: keep the billing schema unsharded',
      body: `# ADR-014\n\n${ADR_OPTIONS('Keep a single schema for now; revisit after the ledger migration.')}`,
    },
  ];

  for (const page of pages) {
    if (existingTitles.has(page.title.toLowerCase())) continue;
    operations.push({
      kind: 'createPage',
      opId: `page:${slug(page.title)}`,
      spaceKey: input.spaceKey,
      title: page.title,
      body: page.body,
    });
  }

  const issueSummary = 'Checkout build failed';
  if (!existingSummaries.has(issueSummary.toLowerCase())) {
    operations.push({
      kind: 'createIssue',
      opId: 'issue:checkout-build-failed',
      projectKey: input.projectKey,
      summary: issueSummary,
      description:
        'The checkout pipeline went red after the billing schema change. Cascade: reconstruct which decision seeded this.',
      issueType: 'Task',
    });
  }

  operations.push({
    kind: 'addComment',
    opId: 'comment:unanswered-alternative',
    targetRef: 'ADR-014: keep the billing schema unsharded',
    targetKind: 'page',
    body: 'We could range-shard by tenant instead — the payments service already proved it works. Nobody picked this up.',
  });

  return operations;
}

export function summarisePlan(operations: readonly SeedOperation[]): Record<string, number> {
  const counts: Record<SeedOperation['kind'], number> = { createPage: 0, createIssue: 0, addComment: 0 };
  for (const operation of operations) counts[operation.kind] = (counts[operation.kind] ?? 0) + 1;
  return counts;
}
