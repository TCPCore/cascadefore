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
  description: 'Work item with comments, space, linked items and external builds',
  objectTypes: ['JiraWorkItem', 'JiraWorkItemComment', 'JiraSpace', 'JiraWorkItemRemoteLink', 'ExternalBuild'],
  cypher: `MATCH (item:JiraIssue)
OPTIONAL MATCH (item)-[:jira_work_item_has_jira_work_item_comment]->(comment:JiraWorkItemComment)
OPTIONAL MATCH (space:JiraSpace)-[:jira_space_has_jira_work_item]->(item)
OPTIONAL MATCH (item)-[:jira_work_item_links_jira_work_item]->(linked:JiraWorkItem)
OPTIONAL MATCH (item)-[:jira_work_item_links_jira_work_item_remote_link]->(remote:JiraWorkItemRemoteLink)
OPTIONAL MATCH (item)-[:jira_work_item_links_external_build]->(build:ExternalBuild)
RETURN item AS workItem,
       comment AS workItemComment,
       space AS jiraSpace,
       linked AS linkedWorkItem,
       remote AS remoteLink,
       build AS build
LIMIT $limit`,
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
 * OUTCOMES — implementation proof for the failed work item.
 *
 * `jira_work_item_links_external_build` / `_external_commit` are documented;
 * deployments hang off repositories and services, not off issues, so they are
 * reached through the build rather than directly.
 */
export const OUTCOME_QUERY: QuerySpec = {
  key: 'outcomes',
  name: 'cascade-outcomes',
  description: 'External builds and commits linked to the failing work item',
  objectTypes: ['JiraWorkItem', 'ExternalBuild', 'ExternalCommit', 'ExternalDeployment'],
  cypher: `MATCH (item:JiraIssue)
WHERE item.ari IN $workItemAris
OPTIONAL MATCH (item)-[:jira_work_item_links_external_build]->(build:ExternalBuild)
OPTIONAL MATCH (item)-[:jira_work_item_links_external_commit]->(commit:ExternalCommit)
OPTIONAL MATCH (build)-[:external_service_links_external_build]->(service:ExternalService)
RETURN build AS build, commit AS commit, service AS service
LIMIT $limit`,
};

/**
 * ATTRIBUTION — the outcome ledger.
 *
 * Commit statuses published by the decisions runner are named `decision/<id>`.
 * Atlassian syncs Bitbucket builds into Teamwork Graph, so those statuses arrive
 * as graph objects for free; this walks from such a build to the work items it
 * is linked to. No shared database, no cross-app call — the join key rides in
 * the name.
 *
 * ⚠️  Verify against TWG Labs: `build.name` is assumed queryable.
 */
export const ATTRIBUTION_QUERY: QuerySpec = {
  key: 'attribution',
  name: 'cascade-attribution',
  description: 'Decision status build → linked work items and commits',
  objectTypes: ['ExternalBuild', 'ExternalCommit', 'JiraWorkItem'],
  cypher: `MATCH (build:ExternalBuild)
WHERE build.name STARTS WITH $decisionPrefix
OPTIONAL MATCH (item:JiraIssue)-[:jira_work_item_links_external_build]->(build)
OPTIONAL MATCH (commit:ExternalCommit)<-[:external_build_has_external_commit]-(build)
RETURN build AS build, item AS workItem, commit AS commit
LIMIT $limit`,
};

export const QUERY_CATALOG: QuerySpec[] = [SPINE_QUERY, BRANCH_QUERY, OUTCOME_QUERY, ATTRIBUTION_QUERY];

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
