# Teamwork Graph queries — paste into TWG Labs

Open <https://teamwork-graph.atlassian.com/query-builder>, select the site, and
paste each query below into the editor. The builder validates syntax and schema
before you save, so a validation error here is exactly what we need to see.

Do them in order and stop at the first failure — each one builds on the last.

## 1. spine — cascade-spine

Work item and its space, by ARI

**Scopes it needs**

- `read:graph:issue:jira`
- `read:graph:project:jira`

```cypher
MATCH (space:JiraSpace)-[:jira_space_has_jira_work_item]->(item:JiraIssue {ari: $workItemAri})
RETURN space AS jiraSpace, item AS workItem
LIMIT 1
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

## Confirmed by execution (2 Nov)

| Object / edge | Status | Shape observed |
|---|---|---|
| `JiraIssue` label | ✅ | node carries `key`, `summary`, `issueId`, `webUrl`, `createdAt` as **hydrated** fields |
| `{ari: '...'}` filter | ✅ | returned `CX-11` exactly |
| `jira_space_has_jira_work_item` | ✅ | space → issue, worked with `item:JiraIssue` as target |
| `ConfluencePage` | ✅ | `id`, `pageId`, `title`, `createdAt`, `lastUpdatedAt`, `status`, `webUrl`, `author` |
| `document_has_comments` | ✅ | returned 3 real comments |
| `ConfluenceComment` | ✅ | `id`, `name`, `bodyStorageValue`, `webUrl`, `author` |
| `jira_work_item_has_jira_work_item_comment` | ❌ errors | name or target label wrong |
| `jira_work_item_links_external_build` | ❌ errors | name or target label wrong |

An unknown relationship type **errors**; it does not return empty. That is why the
spine query now uses only the proven space edge.

`ConfluenceComment.bodyStorageValue` carries the real HTML body, so decision
synthesis can read what a comment actually said — including an unanswered
alternative.

### E1/E2 variants worth one more try

Drop the target label (the label, not the edge, may be wrong):

```cypher
MATCH (item:JiraIssue)-[:jira_work_item_has_jira_work_item_comment]->(c) RETURN c LIMIT 3
```

```cypher
MATCH (item:JiraIssue)-[:jira_work_item_links_external_build]->(b) RETURN b LIMIT 3
```

Swap the source label to the documented one:

```cypher
MATCH (item:JiraWorkItem)-[:jira_work_item_has_jira_work_item_comment]->(c) RETURN c LIMIT 3
```
