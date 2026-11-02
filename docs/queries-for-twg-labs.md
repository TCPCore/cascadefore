# Teamwork Graph queries — paste into TWG Labs

> **Rewritten 2 Nov** against the authoritative relationship catalog
> (`/api-reference/relationship-types/overview`). Relationship names are
> snake_case `<source>_<verb>_<target>`; the label is `JiraIssue`; only `ari` is
> queryable, and **there is no Confluence-page → work-item edge**.

Open <https://teamwork-graph.atlassian.com/query-builder>, select the site, and
paste each query below into the editor. The builder validates syntax and schema
before you save, so a validation error here is exactly what we need to see.

Do them in order and stop at the first failure — each one builds on the last.

## 1. spine — cascade-spine

Work item with comments, space, linked items and external builds

**Scopes it needs**

- `read:graph:issue:jira`
- `read:graph:issue-comment:jira`
- `read:graph:project:jira`
- `read:graph:issue-remote-link:jira`
- `read:graph:build:external`

```cypher
MATCH (item:JiraIssue)
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
LIMIT $limit
```

---

## 2. branches — cascade-branches

Confluence pages and their comment threads

**Scopes it needs**

- `read:graph:page:confluence`
- `read:graph:comment:confluence`

```cypher
MATCH (page:ConfluencePage)
WHERE page.ari IN $pageAris
OPTIONAL MATCH (page)-[:document_has_comments]->(comment:ConfluenceComment)
RETURN page AS page, comment AS comment
LIMIT $limit
```

---

## 3. outcomes — cascade-outcomes

External builds and commits linked to the failing work item

**Scopes it needs**

- `read:graph:issue:jira`
- `read:graph:build:external`
- `read:graph:commit:external`
- `read:graph:deployment:external`

```cypher
MATCH (item:JiraIssue)
WHERE item.ari IN $workItemAris
OPTIONAL MATCH (item)-[:jira_work_item_links_external_build]->(build:ExternalBuild)
OPTIONAL MATCH (item)-[:jira_work_item_links_external_commit]->(commit:ExternalCommit)
OPTIONAL MATCH (build)-[:external_service_links_external_build]->(service:ExternalService)
RETURN build AS build, commit AS commit, service AS service
LIMIT $limit
```

---

## 4. attribution — cascade-attribution

Decision status build → linked work items and commits

**Scopes it needs**

- `read:graph:build:external`
- `read:graph:commit:external`
- `read:graph:issue:jira`

```cypher
MATCH (build:ExternalBuild)
WHERE build.name STARTS WITH $decisionPrefix
OPTIONAL MATCH (item:JiraIssue)-[:jira_work_item_links_external_build]->(build)
OPTIONAL MATCH (commit:ExternalCommit)<-[:external_build_has_external_commit]-(build)
RETURN build AS build, item AS workItem, commit AS commit
LIMIT $limit
```

---

## What to send back

For each query: **validated and saved** (then paste the generated query key), or
the **validation error text** verbatim. The error names the offending
relationship or object type, which is the thing I cannot guess from the docs.

---

## Confirmed edges (2 Nov)

`jira_space_has_jira_work_item` **works** and returned `CX-11`:

```yaml
space: JiraSpace  key=CX  name="Core Experience"
item:  JiraWorkItem  key=CX-11  issueId=66400
       ari:cloud:jira:e264c23b-67d7-48c5-ba33-9ef74f000ab6:issue/66400
```

Two consequences:

1. Teamwork Graph indexed a work item created roughly an hour earlier — sync is
   effectively immediate, so the demo can rely on freshly created content.
2. A bare `MATCH (item:JiraIssue) … LIMIT n` returns an **arbitrary window**, so the
   target issue is usually absent. The spine must filter, and only `ari` can be
   filtered on — a key alone is not enough, because the ARI needs the numeric
   `issueId`.

## Final probe — does `ari` filtering work?

```cypher
MATCH (item:JiraIssue {ari: 'ari:cloud:jira:e264c23b-67d7-48c5-ba33-9ef74f000ab6:issue/66400'})
OPTIONAL MATCH (item)-[:jira_work_item_has_jira_work_item_comment]->(c:JiraWorkItemComment)
OPTIONAL MATCH (space:JiraSpace)-[:jira_space_has_jira_work_item]->(item)
OPTIONAL MATCH (item)-[:jira_work_item_links_external_build]->(build:ExternalBuild)
RETURN item, c, space, build LIMIT 6
```

If this returns the CX-11 node, the spine is fully validated: label, `ari` filter,
and three edges in one query.
