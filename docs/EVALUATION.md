# Evaluate Cascade in 60 seconds

```bash
npm run evaluate
```

That installs, builds the panel, and serves the product on
**http://localhost:4173**. No Atlassian account, no install, no approval.

It runs on **real recorded data**: the Teamwork Graph payloads from
`one-atlas-xoan` for work item `CX-11`, Confluence page `2129941`, and the three
comments people actually wrote in 2022. The badge in the header names the source,
so you always know whether you are looking at seeded or real evidence.

---

## A four-minute tour

1. **Case base** — the decision matrix: 6 decisions across 7 areas, 4 enforced,
   1 violated, 1 orphaned. The orphan is the one nobody can test.
2. **Ask the index** — type *"why does the billing service use Postgres"*. One
   hit, and it tells you why it matched (`rationale mentions "billing"`).
3. **Open that decision** — its test result, then **Paths not taken**:
   - SQLite — rejected because *no concurrent writers*; no precedent existed
   - MongoDB — rejected because *weak ACID at the time*; known then: `0009`
     took MongoDB for audit logs and held; learned since: `0027` moved the
     ledger to MongoDB and reverted it
4. **Reconstruction** — run it on `CX-11` and open the decision tree: one
   decision, three positions, and the resolution they actually took.
5. **Projected tree** — set *As of* to `2020-01-01`: *"no decision had been made
   yet; every path was still open."* Set it back: four decisions are in force.
   Nothing was stored — the tree is projected from the index at the date you ask.
6. **Forensic view** — the timeline dates every entry and marks what was
   knowable at the time of the action.

---

## What to look for

| Question | Where the answer is |
|---|---|
| Is the counterfactual honest? | *Known at decision time* vs *Learned since* on any rejected path |
| Does it avoid hindsight? | The as-of picker; `invisibleAfter` in the API |
| Is it honest about gaps? | The orphan count, and the "no precedent — decided on documentation" line |
| Does it work in Jira? | [INSTALL.md](INSTALL.md) Path B |

---

## Also checkable without a browser

```bash
npm run verify   # types (both projects), 261 tests, lint, both bundles
npm run a11y     # 0 WCAG AA violations across five views
```

The same facts are exposed as MCP tools if you prefer a terminal:

```bash
npx -y @modelcontextprotocol/inspector
# connect to: https://mcp.atlassian.com/forge/1fcb1899-1194-47c1-a794-26e4d3e59e0f
```
