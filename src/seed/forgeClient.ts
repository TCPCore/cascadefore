import api, { route } from '@forge/api';

import type { SeedClient } from './apply';

/**
 * Forge binding for the demo seeder.
 *
 * The plan and the executor are tested; this is the adapter that turns them
 * into Jira and Confluence calls made as the app, using the `write:jira-work`
 * and `write:confluence-content` scopes already granted on the site.
 *
 * ⚠️ Not exercised against a live site in this repo yet. The first run should
 * be against the development environment, not production.
 */

interface CreatedPage {
  id?: string;
  title?: string;
}

interface CreatedIssue {
  key?: string;
}

interface CreatedComment {
  id?: string;
}

export function createForgeSeedClient(spaceKey: string): SeedClient {
  return {
    async createPage(input) {
      const response = await api.asApp().requestConfluence(route`/wiki/rest/api/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          type: 'page',
          title: input.title,
          space: { key: input.spaceKey || spaceKey },
          body: {
            storage: { value: `<p>${input.body.replace(/\n/g, '</p><p>')}</p>`, representation: 'storage' },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`confluence ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
      const page = (await response.json()) as CreatedPage;
      return { id: page.id ?? 'unknown', title: page.title ?? input.title };
    },

    async createIssue(input) {
      const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          fields: {
            project: { key: input.projectKey },
            summary: input.summary,
            description: {
              type: 'doc',
              version: 1,
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: input.description }] },
              ],
            },
            issuetype: { name: input.issueType },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`jira ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
      const issue = (await response.json()) as CreatedIssue;
      return { key: issue.key ?? 'unknown' };
    },

    async addComment(input) {
      if (input.targetKind === 'issue') {
        const response = await api.asApp().requestJira(route`/rest/api/3/issue/${input.targetRef}/comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            body: {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: input.body }] }],
            },
          }),
        });
        if (!response.ok) throw new Error(`jira ${response.status}`);
        const comment = (await response.json()) as CreatedComment;
        return { id: comment.id ?? 'unknown' };
      }

      // Page comments need the page id, not its title; the caller passes a title
      // so this resolves it first.
      const lookup = await api
        .asApp()
        .requestConfluence(
          route`/wiki/rest/api/content?spaceKey=${spaceKey}&title=${input.targetRef}&limit=1`,
        );
      const found = (await lookup.json()) as { results?: Array<{ id?: string }> };
      const pageId = found.results?.[0]?.id;
      if (!pageId) throw new Error(`page not found: ${input.targetRef}`);

      const response = await api
        .asApp()
        .requestConfluence(route`/wiki/rest/api/content/${pageId}/child/comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            type: 'comment',
            container: { id: pageId, type: 'page' },
            body: {
              storage: { value: `<p>${input.body}</p>`, representation: 'storage' },
            },
          }),
        });

      if (!response.ok) throw new Error(`confluence ${response.status}`);
      const comment = (await response.json()) as CreatedComment;
      return { id: comment.id ?? 'unknown' };
    },
  };
}
