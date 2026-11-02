import type { SeedOperation } from './plan';

/**
 * Executing a seed plan.
 *
 * The client is injected so the same plan runs against Confluence/Jira in the
 * app, against a fake in tests, and against nothing at all when a site is not
 * available. The executor is deliberately dumb: it applies operations in order
 * and records failures per operation rather than aborting the scene.
 */

export interface SeedClient {
  createPage(input: { spaceKey: string; title: string; body: string }): Promise<{ id: string; title: string }>;
  createIssue(input: {
    projectKey: string;
    summary: string;
    description: string;
    issueType: string;
  }): Promise<{ key: string }>;
  addComment(input: { targetRef: string; targetKind: 'issue' | 'page'; body: string }): Promise<{ id: string }>;
}

export interface SeedOutcome {
  applied: Array<{ opId: string; result: string }>;
  failed: Array<{ opId: string; message: string }>;
}

export async function applySeed(
  operations: readonly SeedOperation[],
  client: SeedClient,
): Promise<SeedOutcome> {
  const outcome: SeedOutcome = { applied: [], failed: [] };

  for (const operation of operations) {
    try {
      switch (operation.kind) {
        case 'createPage': {
          const page = await client.createPage({
            spaceKey: operation.spaceKey,
            title: operation.title,
            body: operation.body,
          });
          outcome.applied.push({ opId: operation.opId, result: page.id });
          break;
        }
        case 'createIssue': {
          const issue = await client.createIssue({
            projectKey: operation.projectKey,
            summary: operation.summary,
            description: operation.description,
            issueType: operation.issueType,
          });
          outcome.applied.push({ opId: operation.opId, result: issue.key });
          break;
        }
        case 'addComment': {
          const comment = await client.addComment({
            targetRef: operation.targetRef,
            targetKind: operation.targetKind,
            body: operation.body,
          });
          outcome.applied.push({ opId: operation.opId, result: comment.id });
          break;
        }
        default:
          break;
      }
    } catch (error) {
      outcome.failed.push({
        opId: operation.opId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcome;
}

/** In-memory client for tests and for the sandbox host. */
export function createMemorySeedClient(): SeedClient & {
  pages: Array<{ id: string; title: string; spaceKey: string }>;
  issues: Array<{ key: string; summary: string }>;
  comments: Array<{ id: string; targetRef: string }>;
} {
  const pages: Array<{ id: string; title: string; spaceKey: string }> = [];
  const issues: Array<{ key: string; summary: string }> = [];
  const comments: Array<{ id: string; targetRef: string }> = [];
  let pageN = 1;
  let issueN = 1;
  let commentN = 1;

  return {
    pages,
    issues,
    comments,
    async createPage(input) {
      const id = `page-${pageN++}`;
      pages.push({ id, title: input.title, spaceKey: input.spaceKey });
      return { id, title: input.title };
    },
    async createIssue(input) {
      const key = `${input.projectKey}-${issueN++}`;
      issues.push({ key, summary: input.summary });
      return { key };
    },
    async addComment(input) {
      const id = `comment-${commentN++}`;
      comments.push({ id, targetRef: input.targetRef });
      return { id };
    },
  };
}
