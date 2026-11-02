# Graph boundary — what Teamwork Graph can and cannot do

**Measured 2 Nov 2026** against `one-atlas-xoan.atlassian.net` using TWG Labs.
Every line below is an executed query, not a reading of the documentation.

---

## The one finding that shapes everything

> **An unknown relationship type errors. It does not return empty.**

A query that cannot plan takes the *entire* reconstruction down with it. It does
not degrade, it fails. So one wrong relationship name in a multi-hop traversal
looks exactly like a broken graph, and debugs as one.

This is the same class of failure as "a missing scope returns an empty result" —
two different causes wearing the same symptom. Both are why the catalog contains
only traversals that have executed.

---

## Confirmed

| Capability | Query | Result |
|---|---|---|
| Work item by ARI | `MATCH (item:JiraIssue {ari: …})` | returned `CX-11` exactly |
| Label | `JiraIssue` | nodes are typed `JiraWorkItem` in the payload |
| Space of an issue | `(space:JiraSpace)-[:jira_space_has_jira_work_item]->(item:JiraIssue)` | returned `CX` "Core Experience" |
| Confluence page | `MATCH (p:ConfluencePage)` | `id`, `pageId`, `title`, `createdAt`, `webUrl`, `author` |
| Page comments | `(p)-[:document_has_comments]->(c:ConfluenceComment)` | 3 real comments |
| Comment body | `ConfluenceComment_bodyStorageValue` | full storage-format HTML |

**Property access is the trap.** `item.key` and `item.summary` are *hydrated
fields*, not Cypher properties. `RETURN item` gives them; `WHERE item.key = …`
errors. Only `ari` is filterable, and an ARI needs the numeric `issueId`, which a
key alone does not provide. The spine therefore resolves key → ARI first, then
filters.

---

## Rejected — three edges that fail to plan

| Edge attempted | Outcome |
|---|---|
| `jira_work_item_has_jira_work_item_comment` | fails to plan |
| `jira_work_item_links_external_build` | fails to plan |
| `confluence_page_mentions_jira_work_item` | does not exist in the catalog at all |

Each was tried with and without a target label, and with both `JiraIssue` and
`JiraWorkItem` as the source label. None planned.

**They are excluded from `QUERY_CATALOG` on purpose.** Including any one of them
would not have produced an empty result — it would have killed every
reconstruction, and the symptom would have pointed at the graph rather than at a
name.

---

## What this forces, architecturally

The original premise was that the graph could attribute an outcome to a decision.
**It cannot.** There is no path from a work item to a build, and no path from a
Confluence page to a work item.

So the system splits into three stores, each holding what it is the only one able
to hold:

```
graph   → context      which issue, which space, which documents, what the comments say
mirror  → decisions    the record, its tests, its status; and the page↔issue link
ledger  → outcomes     what was observed when the tests ran
```

The graph tells you **what the work is**. The case base tells you **whether the
decision held**.

That sentence survives contact with the schema. The original design did not.

---

## Consequences worth stating in the submission

1. **Attribution is ours, not the graph's.** The runner publishes
   `decision/<id>`; the mirror and ledger hold the result. Any claim that
   Teamwork Graph attributes outcomes would be false.
2. **Sync latency is real.** A work item created at 12:07 appeared in the graph
   by 13:30. A seeder that creates content and immediately reads it will see
   nothing. Demo against pre-existing data.
3. **The demo can use real data.** Page `2129941` — *Mobile Development Strategy
   – Project Charter* — carries three genuine comments including an unanswered
   alternative and a resolution. That is a decision record in the wild, already
   in the graph.

---

## Open question (not blocked on)

Whether a Confluence page can reach a work item by *any* relationship. Three
candidates failed. A schema browser in TWG Labs would answer it in one view; a
few more candidate names would answer it in a few queries. It does not block the
product, because the mirror owns that link.

---

## A fourth instance of the same failure class

Three schema assumptions produced plausible-looking output that was silently wrong:

| Instance | Assumption | Reality | Cost |
|---|---|---|---|
| Label | `JiraWorkItem` | `JiraIssue` | every `MATCH` failed |
| Properties | flat and filterable | hydrated; filter in code | every `WHERE` failed |
| Relationship names | documented names plan | unknown names **error** | a whole query dies, not one hop |
| Comment identity | the comment name is the label | every reply is `Re: <page>` | three branches with one label |

The common thread: **a schema assumption whose output looks plausible.** Three
identical "Re: Mobile Development Strategy" branches do not look broken unless you
read them — they look like three threads. It is only broken because a comment's
identity is its text, not its subject line.

That is the same shape as "unknown relationship types error rather than return
empty": a failure mode wearing another failure mode's clothes.

**Response:** the extractor now asserts distinctness of branch labels in a test,
rather than hoping for it. Plausible output is not evidence; an assertion is.
