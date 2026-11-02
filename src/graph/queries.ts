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
 * SPINE — from the failing work item, walk backwards to the decisions that
 * could have produced it: linked documents, their comment threads, and the
 * work items that share their component.
 */
export const SPINE_QUERY: QuerySpec = {
  key: 'spine',
  name: 'cascade-spine',
  description: 'Causal spine: failing work item → linked docs → comments → sibling work items',
  objectTypes: ['JiraWorkItem', 'JiraSpace', 'JiraWorkItemRemoteLink', 'ConfluencePage', 'ConfluenceComment', 'AtlassianUser'],
  cypher: `MATCH (item:JiraWorkItem {key: $workItemKey})
OPTIONAL MATCH (item)<-[:jira_space_has_jira_work_item]-(space:JiraSpace)
OPTIONAL MATCH (item)-[:jira_work_item_has_remote_link]->(link:JiraWorkItemRemoteLink)
OPTIONAL MATCH (item)<-[:jira_work_item_linked_to_jira_work_item]-(linked:JiraWorkItem)
WITH item, space, collect(DISTINCT link) AS links, collect(DISTINCT linked) AS linkedItems
OPTIONAL MATCH (page:ConfluencePage)-[:confluence_page_mentions_jira_work_item]->(item)
WITH item, space, links, linkedItems, collect(DISTINCT page) AS pages
UNWIND (CASE WHEN size(pages) = 0 THEN [null] ELSE pages END) AS page
OPTIONAL MATCH (page)-[:confluence_page_has_comment]->(comment:ConfluenceComment)
OPTIONAL MATCH (comment)<-[:atlassian_user_created_confluence_comment]-(pageCommentAuthor:AtlassianUser)
RETURN item AS workItem,
       space AS jiraSpace,
       links AS remoteLinks,
       linkedItems AS linkedWorkItems,
       page AS page,
       comment AS pageComment,
       pageCommentAuthor AS commentAuthor
LIMIT $limit`,
};

/**
 * BRANCHES — the evidenced alternatives at each decision point: sibling
 * components that chose differently, and comment threads that proposed a path
 * and were never answered.
 */
export const BRANCH_QUERY: QuerySpec = {
  key: 'branches',
  name: 'cascade-branches',
  description: 'Evidenced alternatives: sibling decisions and unanswered proposals',
  objectTypes: ['JiraWorkItem', 'JiraWorkItemComment', 'ConfluencePage', 'ConfluenceComment', 'AtlassianUser'],
  cypher: `MATCH (page:ConfluencePage)-[:confluence_page_has_comment]->(thread:ConfluenceComment)
WHERE page.ari IN $pageAris
OPTIONAL MATCH (thread)-[:confluence_comment_replies_to]->(reply:ConfluenceComment)
OPTIONAL MATCH (reply)<-[:atlassian_user_created_confluence_comment]-(author:AtlassianUser)
RETURN page AS page,
       thread AS thread,
       collect(DISTINCT reply) AS replies,
       collect(DISTINCT author) AS replyAuthors,
       size(collect(DISTINCT reply)) AS replyCount
LIMIT $limit`,
};

/**
 * OUTCOMES — implementation proof. If an alternative was actually built and
 * deployed somewhere, that is objective evidence of viability and it is the
 * strongest signal the model has. Failures count too, at a steep discount.
 */
export const OUTCOME_QUERY: QuerySpec = {
  key: 'outcomes',
  name: 'cascade-outcomes',
  description: 'Implementation proof: builds, deployments and PRs on alternative paths',
  objectTypes: ['ExternalBuild', 'ExternalDeployment', 'ExternalPullRequest', 'ExternalCommit', 'CompassComponent'],
  cypher: `MATCH (component:CompassComponent)-[:compass_component_has_external_build]->(build:ExternalBuild)
WHERE component.ari IN $componentAris
OPTIONAL MATCH (component)-[:compass_component_has_external_deployment]->(deployment:ExternalDeployment)
OPTIONAL MATCH (component)-[:compass_component_has_external_pull_request]->(pr:ExternalPullRequest)
RETURN component AS component,
       build AS build,
       deployment AS deployment,
       pr AS pullRequest
LIMIT $limit`,
};

/**
 * ATTRIBUTION — the outcome ledger.
 *
 * Commit statuses published by the decisions runner are named `decision/<id>`.
 * Atlassian syncs Bitbucket builds into Teamwork Graph, so those statuses arrive
 * as graph objects for free. This traversal walks from such a build to the
 * repository, the work items it touched, and any pull request or deployment in
 * the same neighbourhood — which is how a violated decision gets linked to the
 * incident that followed it, with no shared database.
 *
 * ⚠️  VERIFY relationship names in TWG Labs before relying on this.
 */
export const ATTRIBUTION_QUERY: QuerySpec = {
  key: 'attribution',
  name: 'cascade-attribution',
  description: 'Decision outcome → build → repository → work items → PRs and deployments',
  objectTypes: ['ExternalBuild', 'ExternalRepository', 'ExternalPullRequest', 'ExternalDeployment', 'JiraWorkItem'],
  cypher: `MATCH (build:ExternalBuild)
WHERE build.name STARTS WITH $decisionPrefix
OPTIONAL MATCH (build)-[:external_build_in_repository]->(repo:ExternalRepository)
OPTIONAL MATCH (build)<-[:external_build_related_to_jira_work_item]-(item:JiraWorkItem)
OPTIONAL MATCH (build)-[:external_build_has_external_pull_request]->(pr:ExternalPullRequest)
OPTIONAL MATCH (repo)-[:external_repository_has_external_deployment]->(deployment:ExternalDeployment)
RETURN build AS build,
       repo AS repository,
       item AS workItem,
       pr AS pullRequest,
       deployment AS deployment
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
};

export function scopesFor(query: QuerySpec): string[] {
  return Array.from(
    new Set(query.objectTypes.map((t) => SCOPE_FOR_OBJECT_TYPE[t]).filter((s): s is string => Boolean(s))),
  );
}
