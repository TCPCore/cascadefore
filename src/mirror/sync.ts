import type { Decision } from '../decisions/types';
import { idFromTitle, renderDecisionPage } from './page';

/**
 * Mirroring decisions to Confluence.
 *
 * Why Confluence and not a database: two Forge apps cannot share Forge SQL, and
 * a Teamwork Graph connector is not available on every site. Site content is the
 * one substrate both a repository-side process and an app-side process can
 * reach, and it is also the one a human can open and edit.
 *
 * The target is an interface so the same sync runs against a fake in tests, the
 * real Confluence REST API in production, and a sandbox when neither is online.
 */

export interface MirrorPage {
  id: string;
  title: string;
  body: string;
  version?: number;
}

export interface MirrorTarget {
  findByTitle(title: string): Promise<MirrorPage | null>;
  create(title: string, body: string): Promise<MirrorPage>;
  update(page: MirrorPage, body: string): Promise<MirrorPage>;
}

export interface SyncResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  errors: Array<{ id: string; message: string }>;
}

/**
 * Idempotent by content, not by timestamp: a page is only updated when its body
 * actually changed. That keeps commit history quiet and makes re-running the
 * mirror after a failed CI step free.
 */
export async function syncDecisions(
  decisions: readonly Decision[],
  target: MirrorTarget,
): Promise<SyncResult> {
  const result: SyncResult = { created: [], updated: [], unchanged: [], errors: [] };

  for (const decision of decisions) {
    const rendered = renderDecisionPage(decision);
    try {
      const existing = await target.findByTitle(rendered.title);

      if (!existing) {
        await target.create(rendered.title, rendered.body);
        result.created.push(decision.id);
        continue;
      }

      if (existing.body === rendered.body) {
        result.unchanged.push(decision.id);
        continue;
      }

      await target.update(existing, rendered.body);
      result.updated.push(decision.id);
    } catch (error) {
      result.errors.push({
        id: decision.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/** In-memory target, used by tests and by the sandbox host. */
export function createMemoryTarget(seed: MirrorPage[] = []): MirrorTarget & { pages: MirrorPage[] } {
  const pages: MirrorPage[] = seed.map((page) => ({ ...page }));
  let nextId = pages.length + 1;

  return {
    pages,
    async findByTitle(title: string): Promise<MirrorPage | null> {
      return pages.find((page) => page.title === title) ?? null;
    },
    async create(title: string, body: string): Promise<MirrorPage> {
      const page: MirrorPage = { id: `page-${nextId++}`, title, body, version: 1 };
      pages.push(page);
      return page;
    },
    async update(page: MirrorPage, body: string): Promise<MirrorPage> {
      const index = pages.findIndex((candidate) => candidate.id === page.id);
      const updated: MirrorPage = { ...page, body, version: (page.version ?? 1) + 1 };
      if (index >= 0) pages[index] = updated;
      return updated;
    },
  };
}

export interface IngestResult {
  decisions: Decision[];
  errors: Array<{ id: string; message: string }>;
}

export { idFromTitle };
