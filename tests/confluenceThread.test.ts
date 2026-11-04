import { describe, expect, it } from 'vitest';

import { artifactsFromThread, createConfluenceThreadReader } from '../src/graph/confluenceThread';

const page = {
  id: '2129941',
  title: 'Mobile Development Strategy - Project Charter',
  createdAt: '2021-08-17T17:46:23.069Z',
  body: { storage: { value: '<p>Project charter</p>' } },
};

const comments = {
  results: [
    {
      id: '2130110',
      createdAt: '2022-03-26T00:20:19.320Z',
      body: { storage: { value: '<p><ac:link></ac:link> Would that be you?</p>' } },
    },
    {
      id: '2130024',
      createdAt: '2022-03-26T00:15:54.357Z',
      body: { storage: { value: '<p>we need to add Finance to the list here</p>' } },
    },
    {
      id: '2130042',
      createdAt: '2022-03-26T00:21:59.292Z',
      body: { storage: { value: '<p>Yes, for now. Dedicated headcount next quarter</p>' } },
    },
  ],
};

const CLOUD = 'e264c23b-67d7-48c5-ba33-9ef74f000ab6';

describe('confluence thread → reconstruction input', () => {
  it('reads a page and its comments as artifacts', () => {
    const artifacts = artifactsFromThread(page, comments, CLOUD);
    expect(artifacts).toHaveLength(4);
    expect(artifacts[0]?.type).toBe('confluence-page');
    expect(artifacts.filter((a) => a.type === 'confluence-comment')).toHaveLength(3);
  });

  it('uses real ARIs so every claim links to its source', () => {
    const artifacts = artifactsFromThread(page, comments, CLOUD);
    expect(artifacts[0]?.ari).toBe(`ari:cloud:confluence:${CLOUD}:page/2129941`);
    expect(artifacts[1]?.ari).toContain(':comment/');
  });

  it('strips storage format out of comment text', () => {
    const artifacts = artifactsFromThread(page, comments, CLOUD);
    const texts = artifacts.map((a) => a.bodyText ?? '');
    expect(texts.some((t) => t.includes('<'))).toBe(false);
    expect(texts.join(' ')).toMatch(/Finance/);
  });

  it('labels a comment by its text, not its subject line', () => {
    const artifacts = artifactsFromThread(page, comments, CLOUD);
    const commentTitles = artifacts.filter((a) => a.type === 'confluence-comment').map((a) => a.title);
    expect(new Set(commentTitles).size).toBe(3);
    expect(commentTitles.some((t) => /Finance/i.test(t))).toBe(true);
  });

  it('groups page and comments under one area so they cluster into one decision', () => {
    const artifacts = artifactsFromThread(page, comments, CLOUD);
    const areas = new Set(artifacts.map((a) => a.areaKey));
    expect(areas.size).toBe(1);
  });

  it('fetches through the injected caller', async () => {
    const calls: string[] = [];
    const read = createConfluenceThreadReader(async (path) => {
      calls.push(path);
      return path.includes('footer-comments') ? comments : page;
    });

    const artifacts = await read('2129941');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/wiki/api/v2/pages/2129941');
    expect(artifacts).toHaveLength(4);
  });
});
