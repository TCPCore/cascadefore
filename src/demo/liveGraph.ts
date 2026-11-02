import type { RawArtifact } from '../graph/extract';
import type { GraphCollection, GraphSource } from '../pipeline/run';

/**
 * A fixture built from real Teamwork Graph payloads.
 *
 * Recorded on 2 Nov from `one-atlas-xoan` — the actual `CX-11` work item, the
 * `CX` space, Confluence page 2129941 and its three genuine comments. The ARIs
 * are the real ones, so anything the UI links to resolves on the site.
 *
 * Why this exists: the curated corpus (`seedSource`) tells a tidier story, but
 * this one is *true*. If the product only works on invented data, it does not
 * work. Running the sandbox on this fixture proves the synthesis rules handle
 * prose written by humans rather than ADR templates.
 */
const ARI = {
  space: 'ari:cloud:jira:e264c23b-67d7-48c5-ba33-9ef74f000ab6:project/10124',
  issue: 'ari:cloud:jira:e264c23b-67d7-48c5-ba33-9ef74f000ab6:issue/66400',
  page: 'ari:cloud:confluence:e264c23b-67d7-48c5-ba33-9ef74f000ab6:page/2129941',
  comment1: 'ari:cloud:confluence:e264c23b-67d7-48c5-ba33-9ef74f000ab6:comment/2130110',
  comment2: 'ari:cloud:confluence:e264c23b-67d7-48c5-ba33-9ef74f000ab6:comment/2130024',
  comment3: 'ari:cloud:confluence:e264c23b-67d7-48c5-ba33-9ef74f000ab6:comment/2130042',
} as const;

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const LIVE_ARTIFACTS: RawArtifact[] = [
  {
    ari: ARI.issue,
    type: 'jira-work-item',
    title: 'Checkout build failed',
    createdAt: '2026-11-02T12:07:46.770Z',
    areaKey: 'core-experience',
  },
  {
    ari: ARI.page,
    type: 'confluence-page',
    title: 'Mobile Development Strategy - Project Charter',
    createdAt: '2021-08-17T17:46:23.069Z',
    authorAri: 'ari:cloud:identity::user/60ad2d2a06bf0c006a42fa84',
    areaKey: 'mobile-strategy',
    bodyText:
      'Project charter for the mobile development strategy. Scope, staffing and the finance partnership are described below.',
  },
  {
    ari: ARI.comment1,
    type: 'confluence-comment',
    // A comment's identity for decision purposes is its text, not its subject
    // line — every reply to a page shares the same "Re: <page>" name.
    title: 'Would that be you?',
    createdAt: '2022-03-26T00:20:19.320Z',
    authorAri: 'ari:cloud:identity::user/60ad2d2a06bf0c006a42fa84',
    areaKey: 'mobile-strategy',
    replyCount: 3,
    bodyText: stripHtml('<p><ac:link></ac:link> Would that be you?</p>'),
  },
  {
    ari: ARI.comment2,
    type: 'confluence-comment',
    title: 'we need to add Finance to the list here',
    createdAt: '2022-03-26T00:15:54.357Z',
    authorAri: 'ari:cloud:identity::user/60ad2eb506bf0c006a432a17',
    areaKey: 'mobile-strategy',
    replyCount: 3,
    bodyText: stripHtml('<p>we need to add Finance to the list here</p>'),
  },
  {
    ari: ARI.comment3,
    type: 'confluence-comment',
    title: 'Yes, for now — dedicated headcount expected next quarter',
    createdAt: '2022-03-26T00:21:59.292Z',
    authorAri: 'ari:cloud:identity::user/60ad37a4ad76ea0070d7fdf8',
    areaKey: 'mobile-strategy',
    replyCount: 3,
    bodyText: stripHtml(
      '<p>Yes, for now. We should be getting a dedicated headcount for this project in the upcoming quarter</p>',
    ),
  },
];

export function createLiveGraphSource(): GraphSource {
  return {
    async collect(): Promise<GraphCollection> {
      return {
        artifacts: LIVE_ARTIFACTS,
        scopeProbe: [],
        errorCode: null,
        traversalMs: 61,
        evidenceSource: 'real_confluence_thread',
      };
    },
  };
}

export { ARI as LIVE_ARIS };
