/**
 * Persisted Cypher catalog.
 *
 * ⚠️  VERIFY EVERY QUERY IN TWG LABS BEFORE REGISTERING.
 * Relationship type names for page↔work-item links are the least stable part
 * of the Preview schema. Nothing outside this file depends on the exact names:
 * `extract.ts` consumes normalised rows, so a rename is a one-file change.
 *
 * Registration is idempotent on query text (see `registerQueries.ts`), so
 * iterating here is cheap: edit → re-register → new queryKey.
 *
 * Docs: https://developer.atlassian.com/platform/teamwork-graph/persisted-cypher-queries/
 */

export interface QuerySpec {
  key: 'spine' | 'branches' | 'outcomes' | 'attribution';
  name: string;
  description: string;
  /** Object types touched anywhere in the traversal — including intermediate hops. */
  objectTypes: string[];
  cypher: string;
}

/**
 * SPINE — from the work item outward, along relationships that actually exist.
 *
 * Three corrections came out of TWG Labs on 2 Nov:
 *
 *   1. the label is `JiraIssue`, not `JiraWorkItem`;
 *   2. `key` and `summary` are hydrated fields, NOT queryable properties — only
 *      `ari` can be filtered on, and an ARI needs the numeric issue id, which a
 *      key alone does not give;
 *   3. relationship names are snake_case `<source>_<verb>_<target>` and there is
 *      **no** Confluence-page → work-item relationship.
 *
 * So this query cannot filter by key. It fetches a bounded window of issues with
 * their real edges and the caller selects the target row by its hydrated `key`.
 * That is a correctness-over-efficiency trade, stated rather than hidden.
 */
export const SPINE_QUERY: QuerySpec = {
  key: 'spine',
  name: 'cascade-spine',
  description: 'Work item and its space, by ARI',
  objectTypes: ['JiraWorkItem', 'JiraSpace'],
  // Only edges proven against the live graph are used here. `JiraIssue` is the
  // real label, `{ari: ...}` is the only filterable property, and the space edge
  // is confirmed. Jira-side comment and build edges are deliberately absent:
  // both names failed to plan, and an unknown relationship type errors rather
  // than returning empty, so including them would break the whole query.
  cypher: `MATCH (space:JiraSpace)-[:jira_space_has_jira_work_item]->(item:JiraIssue {ari: $workItemAri})
RETURN space AS jiraSpace, item AS workItem
LIMIT 1`,
};

/**
 * BRANCHES — Confluence documents and their comment threads.
 *
 * `document_has_comments` is the documented edge; there is no page→issue edge,
 * so a decision recorded on a page is reached from the page side, not from the
 * work item. The caller supplies page ARIs it learned elsewhere (remote links,
 * dossier pages it wrote itself).
 */
export const BRANCH_QUERY: QuerySpec = {
  key: 'branches',
  name: 'cascade-branches',
  description: 'Confluence pages and their comment threads',
  objectTypes: ['ConfluencePage', 'ConfluenceComment'],
  cypher: `MATCH (page:ConfluencePage)
WHERE page.ari IN $pageAris
OPTIONAL MATCH (page)-[:document_has_comments]->(comment:ConfluenceComment)
RETURN page AS page, comment AS comment
LIMIT $limit`,
};

/**
 * There is deliberately no outcomes or attribution traversal here.
 *
 * Two edges were tried against the live graph and both failed to plan:
 * `jira_work_item_links_external_build` and
 * `jira_work_item_has_jira_work_item_comment`. An unknown relationship type
 * errors rather than returning empty, so including either would break the whole
 * query.
 *
 * The consequence is architectural, not cosmetic: the graph is the **context**
 * layer (what the work is, which space it belongs to, which documents discuss
 * it). Outcomes come from the two places we control — the Confluence mirror and
 * the Forge SQL ledger. That split is stated in docs/ARCHITECTURE.md.
 */

export const QUERY_CATALOG: QuerySpec[] = [SPINE_QUERY, BRANCH_QUERY];

/**
 * Teamwork Graph scope per object type. A missing scope does not error — it
 * returns an empty result — so this table doubles as the diagnostic source for
 * the scope probe in the empty state.
 */
export const SCOPE_FOR_OBJECT_TYPE: Record<string, string> = {
  JiraWorkItem: 'read:graph:issue:jira',
  JiraWorkItemComment: 'read:graph:issue-comment:jira',
  JiraWorkItemStatus: 'read:graph:issue-status:jira',
  JiraSpace: 'read:graph:project:jira',
  JiraSprint: 'read:graph:sprint:jira',
  JiraVersion: 'read:graph:version:jira',
  JiraWorkItemRemoteLink: 'read:graph:issue-remote-link:jira',
  ConfluencePage: 'read:graph:page:confluence',
  ConfluenceComment: 'read:graph:comment:confluence',
  ConfluenceSpace: 'read:graph:space:confluence',
  AtlassianUser: 'read:graph:user:atlassian',
  AtlassianTeam: 'read:graph:team:atlassian',
  AtlassianGoal: 'read:graph:goal:atlassian',
  CompassComponent: 'read:graph:component:compass',
  ExternalBuild: 'read:graph:build:external',
  ExternalDeployment: 'read:graph:deployment:external',
  ExternalPullRequest: 'read:graph:pull-request:external',
  ExternalCommit: 'read:graph:commit:external',
  ExternalRepository: 'read:graph:repository:external',
  ExternalService: 'read:graph:service:external',
};

export function scopesFor(query: QuerySpec): string[] {
  return Array.from(
    new Set(query.objectTypes.map((t) => SCOPE_FOR_OBJECT_TYPE[t]).filter((s): s is string => Boolean(s))),
  );
}
