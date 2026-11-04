import type { RawArtifact } from './extract';
import type { GraphSource } from '../pipeline/run';

/**
 * Reads a real Confluence thread and turns it into reconstruction input.
 *
 * This is the difference between a demo and a product: the panel can point at a
 * page the user owns and reconstruct the decision from the comments people
 * actually wrote, with the real ARIs so every claim links back to its source.
 *
 * REST v2, storage format for comment bodies. The caller is injected so the
 * fetch is testable without a Jira/Confluence runtime.
 */
export interface ConfluenceThreadCaller {
  (path: string): Promise<unknown>;
}

interface V2Page {
  id?: string;
  title?: string;
  createdAt?: string;
  version?: { createdAt?: string };
  authorId?: string;
  _links?: { webui?: string };
  body?: { storage?: { value?: string } };
}

interface V2CommentList {
  results?: Array<{
    id?: string;
    createdAt?: string;
    version?: { createdAt?: string };
    authorId?: string;
    body?: { storage?: { value?: string } };
    _links?: { webui?: string };
  }>;
}

function stripStorage(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function siteBase(): string {
  return 'https://one-atlas-xoan.atlassian.net';
}

export function artifactsFromThread(
  page: V2Page,
  comments: V2CommentList,
  cloudId: string | null,
): RawArtifact[] {
  const now = new Date().toISOString();
  const confluenceAri = (kind: string, id: string) =>
    cloudId ? `ari:cloud:confluence:${cloudId}:${kind}/${id}` : `https://${kind}/${id}`;

  const out: RawArtifact[] = [];

  if (page?.id) {
    out.push({
      ari: confluenceAri('page', page.id),
      type: 'confluence-page',
      title: page.title ?? `Page ${page.id}`,
      createdAt: page.createdAt ?? page.version?.createdAt ?? now,
      authorAri: page.authorId,
      areaKey: (page.title ?? page.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48),
      bodyText: stripStorage(page.body?.storage?.value),
    });
  }

  for (const comment of comments?.results ?? []) {
    if (!comment.id) continue;
    out.push({
      ari: confluenceAri('comment', comment.id),
      type: 'confluence-comment',
      // A comment's identity for decision purposes is its text, not "Re: <page>".
      title: stripStorage(comment.body?.storage?.value).slice(0, 120) || `Comment ${comment.id}`,
      createdAt: comment.createdAt ?? comment.version?.createdAt ?? now,
      authorAri: comment.authorId,
      areaKey: (page?.title ?? page?.id ?? 'thread').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48),
      replyCount: 1,
      bodyText: stripStorage(comment.body?.storage?.value),
    });
  }

  return out;
}

/**
 * A graph source backed by a live Confluence thread.
 *
 * When the read fails it reports the error rather than pretending the thread was
 * empty — an unreadable page and a page with no comments are different problems.
 */
export function createConfluenceSource(pageId: string, caller: ConfluenceThreadCaller): GraphSource {
  const read = createConfluenceThreadReader(caller);
  return {
    async collect() {
      const started = Date.now();
      try {
        const artifacts = await read(pageId);
        return {
          artifacts,
          scopeProbe: [],
          errorCode: artifacts.length === 0 ? 'EMPTY_THREAD' : null,
          traversalMs: Date.now() - started,
          evidenceSource: 'real_confluence_thread',
        };
      } catch (error) {
        return {
          artifacts: [],
          scopeProbe: [],
          errorCode: `CONFLUENCE_READ_FAILED: ${error instanceof Error ? error.message : String(error)}`,
          traversalMs: Date.now() - started,
          evidenceSource: 'real_confluence_thread',
        };
      }
    },
  };
}

export function createConfluenceThreadReader(caller: ConfluenceThreadCaller) {
  return async function read(pageId: string): Promise<RawArtifact[]> {
    const page = (await caller(`/wiki/api/v2/pages/${pageId}?body-format=storage`)) as V2Page;
    const comments = (await caller(
      `/wiki/api/v2/pages/${pageId}/footer-comments?body-format=storage&limit=50`,
    )) as V2CommentList;

    const cloudId = process.env.CASCADE_CLOUD_ID ?? null;
    void siteBase;
    return artifactsFromThread(page, comments, cloudId);
  };
}
