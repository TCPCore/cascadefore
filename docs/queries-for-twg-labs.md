# Teamwork Graph queries — paste into TWG Labs

Open <https://teamwork-graph.atlassian.com/query-builder>, select the site, and
paste each query below into the editor. The builder validates syntax and schema
before you save, so a validation error here is exactly what we need to see.

Do them in order and stop at the first failure — each one builds on the last.


---

## Step 0 — probes (run these first, in order)

A generic *"There was an issue running this query"* almost always means the query
parsed but failed at execution — unbound parameters (`$workItemKey`, `$limit`),
or a relationship/property that does not exist. These probes separate those.

**P1 — is there data at all?**

```cypher
MATCH (item:JiraWorkItem) RETURN item.key AS key LIMIT 5
```

**P2 — does a literal filter work?** (no parameters involved)

```cypher
MATCH (item:JiraWorkItem) WHERE item.key = 'CX-11' RETURN item.key AS key, item.summary AS summary
```

**P3 — the important one: what relationships actually exist?**

```cypher
MATCH (n:JiraWorkItem {key: 'CX-11'})-[r]-(m) RETURN type(r) AS rel, labels(m) AS target LIMIT 25
```

P3's output is the thing I cannot guess. It names the real relationship types and
target labels, which is what every query in this file depends on.

If `type()` / `labels()` are unsupported, try:

```cypher
MATCH (n:JiraWorkItem {key: 'CX-11'})-[r]->(m) RETURN r, m LIMIT 25
```

---

## Step 1 — the full queries

## 1. spine — cascade-spine

Causal spine: failing work item → linked docs → comments → sibling work items

**Scopes it needs**

- `read:graph:issue:jira`
- `read:graph:project:jira`
- `read:graph:issue-remote-link:jira`
- `read:graph:page:confluence`
- `read:graph:comment:confluence`
- `read:graph:user:atlassian`

```cypher
MATCH (item:JiraWorkItem {key: $workItemKey})
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
LIMIT $limit
```

---

## 2. branches — cascade-branches

Evidenced alternatives: sibling decisions and unanswered proposals

**Scopes it needs**

- `read:graph:issue:jira`
- `read:graph:issue-comment:jira`
- `read:graph:page:confluence`
- `read:graph:comment:confluence`
- `read:graph:user:atlassian`

```cypher
MATCH (page:ConfluencePage)-[:confluence_page_has_comment]->(thread:ConfluenceComment)
WHERE page.ari IN $pageAris
OPTIONAL MATCH (thread)-[:confluence_comment_replies_to]->(reply:ConfluenceComment)
OPTIONAL MATCH (reply)<-[:atlassian_user_created_confluence_comment]-(author:AtlassianUser)
RETURN page AS page,
       thread AS thread,
       collect(DISTINCT reply) AS replies,
       collect(DISTINCT author) AS replyAuthors,
       size(collect(DISTINCT reply)) AS replyCount
LIMIT $limit
```

---

## 3. outcomes — cascade-outcomes

Implementation proof: builds, deployments and PRs on alternative paths

**Scopes it needs**

- `read:graph:build:external`
- `read:graph:deployment:external`
- `read:graph:pull-request:external`
- `read:graph:commit:external`
- `read:graph:component:compass`

```cypher
MATCH (component:CompassComponent)-[:compass_component_has_external_build]->(build:ExternalBuild)
WHERE component.ari IN $componentAris
OPTIONAL MATCH (component)-[:compass_component_has_external_deployment]->(deployment:ExternalDeployment)
OPTIONAL MATCH (component)-[:compass_component_has_external_pull_request]->(pr:ExternalPullRequest)
RETURN component AS component,
       build AS build,
       deployment AS deployment,
       pr AS pullRequest
LIMIT $limit
```

---

## 4. attribution — cascade-attribution

Decision outcome → build → repository → work items → PRs and deployments

**Scopes it needs**

- `read:graph:build:external`
- `read:graph:repository:external`
- `read:graph:pull-request:external`
- `read:graph:deployment:external`
- `read:graph:issue:jira`

```cypher
MATCH (build:ExternalBuild)
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
LIMIT $limit
```

---

## What to send back

For each query: **validated and saved** (then paste the generated query key), or
the **validation error text** verbatim. The error names the offending
relationship or object type, which is the thing I cannot guess from the docs.
