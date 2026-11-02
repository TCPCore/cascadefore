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

## What to send back

For each query: **validated and saved** (then paste the generated query key), or
the **validation error text** verbatim. The error names the offending
relationship or object type, which is the thing I cannot guess from the docs.
