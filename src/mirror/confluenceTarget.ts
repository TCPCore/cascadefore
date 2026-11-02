import api, { route } from '@forge/api';

import type { MirrorPage, MirrorTarget } from './sync';
import { fromStorageFormat, toStorageFormat } from './storage';

/**
 * Confluence binding for the mirror.
 *
 * Rendering, idempotency and the storage-format round trip are all tested in
 * `src/mirror/*` and `tests/mirror.test.ts`. This file only turns those into
 * HTTP calls, so a failure here is plumbing rather than logic.
 *
 * `route` is used with static segments and interpolated *values* only — never a
 * whole path — because the runtime treats an interpolated path as untrusted and
 * will encode or reject it.
 *
 * ⚠️ Not exercised against a live site yet; confirm endpoint shapes on the
 * development environment before relying on it.
 */

interface ContentEnvelope {
  id?: string;
  title?: string;
  version?: { number?: number };
  body?: { storage?: { value?: string } };
  results?: ContentEnvelope[];
}

/** The subset of the fetch Response that Forge's product clients provide. */
interface MinimalResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

async function expectOk(response: MinimalResponse, label: string): Promise<ContentEnvelope> {
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${label} ${response.status}: ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as ContentEnvelope;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

export function createConfluenceTarget(spaceKey: string): MirrorTarget {
  return {
    async findByTitle(title: string): Promise<MirrorPage | null> {
      const response = await api
        .asApp()
        .requestConfluence(
          route`/wiki/rest/api/content?spaceKey=${spaceKey}&title=${title}&expand=body.storage,version&limit=1`,
          { headers: JSON_HEADERS },
        );

      const envelope = await expectOk(response, 'confluence lookup');
      const page = envelope.results?.[0];
      if (!page?.id) return null;

      return {
        id: page.id,
        title: page.title ?? title,
        body: fromStorageFormat(page.body?.storage?.value ?? ''),
        version: page.version?.number ?? 1,
      };
    },

    async create(title: string, body: string): Promise<MirrorPage> {
      const response = await api.asApp().requestConfluence(route`/wiki/rest/api/content`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          type: 'page',
          title,
          space: { key: spaceKey },
          body: { storage: { value: toStorageFormat(body), representation: 'storage' } },
        }),
      });

      const envelope = await expectOk(response, 'confluence create');
      return {
        id: envelope.id ?? 'unknown',
        title: envelope.title ?? title,
        body,
        version: envelope.version?.number ?? 1,
      };
    },

    async update(page: MirrorPage, body: string): Promise<MirrorPage> {
      const response = await api
        .asApp()
        .requestConfluence(route`/wiki/rest/api/content/${page.id}`, {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            id: page.id,
            type: 'page',
            title: page.title,
            space: { key: spaceKey },
            version: { number: (page.version ?? 1) + 1 },
            body: { storage: { value: toStorageFormat(body), representation: 'storage' } },
          }),
        });

      const envelope = await expectOk(response, 'confluence update');
      return {
        id: envelope.id ?? page.id,
        title: envelope.title ?? page.title,
        body,
        version: envelope.version?.number ?? (page.version ?? 1) + 1,
      };
    },
  };
}
