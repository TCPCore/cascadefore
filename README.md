# Cascade

Reconstructs the decision that seeded a failure, scores the paths that were evidenced at the time, and recommends the cheapest evidenced way back to the team's goal — every claim carrying an ARI.

Built for **Codegeist 2026** on Forge + Teamwork Graph.

> 📋 **Scope, tasks and milestones live in [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md)** — the single source of truth for what is being built and what is done. Track: **Apps for Software Teams**. Entered for **Best Agents**, **Best app with Atlassian MCP**, **Best apps with Teamwork Graph integration**, and **Best Marketplace published app**.

> The failure wasn't a bad decision. It was an unconnected graph.

---

## See it in 30 seconds (no Jira)

```bash
npm install
npm --prefix static/panel install
npm run serve:web
```

Open **http://127.0.0.1:4173**, then press **Run Cascade**.

Or generate a static, self-contained report of two runs against the same evidence:

```bash
npm run render:report   # writes demo/report.html
```

Both paths run the **real engine** — the same pipeline the Forge app runs. Only the host differs.

---

## The one idea

Teamwork Graph has no `Decision` object. Cascade synthesises decision nodes from four evidence classes — documented, threaded, transitional and implicit — then scores each recorded alternative on two axes:

| | Meaning | Computed from |
|---|---|---|
| `W_k` knowability | what the team could reasonably have known *at the time* | only evidence created on or before the decision date |
| `W_v` viability | what proved to work, judging by everything since | implementation proof (builds, deployments, PRs) and outcomes |

`gap = W_v − W_k`. A high gap means the organisation had the evidence and never connected it. That is the product.

The same evidence, scored against two different intents, produces two different recommendations — which is why the output is not hindsight bias. The pipeline test asserts this.

---

## Status

| Area | State | Verified by |
|---|---|---|
| Domain model, time gate, scoring, intent policy, graft assembly | done | 73 unit tests |
| Graph layer: persisted-Cypher catalog, paged client, decision synthesis | done | unit tests for synthesis + pagination |
| Storage: DDL, statements, hydration, repository | done | typecheck + mapper tests |
| Pipeline: traverse → synthesise → score → rank → persist | done | 8 end-to-end tests on a seeded graph |
| Two-intent flip | done | pipeline test |
| Resolver + async consumer + action | done | typecheck; deployed |
| Custom UI panel | done | `vite build`; served standalone |
| `rovo:skill` / `rovo:agent` / `rovo:mcp` manifest + artefacts | done | `forge lint` clean; **not** exercised at runtime |
| Deployed Forge app | **live** | v2.1.0 production, Runs-on-Atlassian eligible |
| In-Jira panel rendering | **not yet confirmed** | module not observed mounting; standalone host exists so the product can be reviewed without it |
| Live Teamwork Graph calls | **not verified** | needs a site with TWG; demo graph is used instead |
| Confluence dossier writer | **hook only** | `writeDossier` dep exists, no implementation |
| Bitbucket build-status trigger | **not implemented** | needs a Bitbucket app (workspace scope) |
| Query registration | **not wired** | no `forge invoke` in CLI 15; needs a webtrigger or admin page |

---

## Run it in Jira

```bash
forge login                 # needs an API token scoped to Forge
forge register Cascade      # creates the app id and Developer Space
forge deploy -e production
forge install --demo-site -p Jira -e production --confirm-scopes
forge install --demo-site -p Confluence -e production --confirm-scopes

forge variables set -e production CASCADE_DEMO_MODE true
forge variables set -e production CASCADE_INLINE true
forge deploy -e production
```

Surfaces: `jira:issueContext` (right-hand column, renders automatically) and `jira:issuePanel` (behind **••• → Apps**).

### Two app identities

An app that carries a licence, or has been submitted for listing, **cannot be shared by installation link** — and Codegeist requires an install link for judges. So the codebase ships with a switcher:

```bash
node scripts/set-app.mjs demo <appId>   # unlicensed, shareable
node scripts/set-app.mjs mkt  <appId>   # licensed, submitted for listing
```

---

## Architecture

```
panel ──invoke/fetch──▶ startCascade ──▶ pipeline ──▶ SQL
                                            │
                          Teamwork Graph (read-only, persisted Cypher)
```

- **Read-only by design.** The Teamwork Graph API has no write path, so the dossier is a Confluence page (ingested afterwards), not a graph mutation.
- **No model in the scoring path.** `src/domain/**` may not import `@forge/llm`. The model is confined to intent parsing, and even there every hard constraint must be literally grounded in the user's text or it is dropped.
- **One panel, two hosts.** `static/panel/src/api.ts` selects the Forge bridge or plain HTTP; everything above it is host-agnostic.

| Path | Responsibility |
|---|---|
| `src/domain/` | time gate, scoring, intent policy, graft — pure, no I/O |
| `src/graph/queries.ts` | persisted Cypher catalog + scope table |
| `src/graph/client.ts` | cursor paging, error classification, GraphQL envelopes |
| `src/graph/extract.ts` | decision synthesis rules, spine/branch assembly |
| `src/pipeline/run.ts` | orchestration with injected dependencies |
| `src/storage/` | DDL, persistence, hydration, repository |
| `static/panel/` | React panel (Vite), builds for Forge **and** standalone |
| `scripts/serve.ts` | standalone HTTP host |
| `scripts/render.ts` | offline HTML report |
| `skills/decision-autopsy/` | `SKILL.md` + scoring rubric |
| `docs/` | platform analysis + technical blueprint |

---

## Tests

```bash
npm test          # 73 tests
npm run typecheck
```

The ones that matter:

- `timeGate.test.ts` — the hindsight-bias defence, including clock skew and unparseable timestamps.
- `scoring.test.ts` — independence discounting, withheld evidence scoring zero knowability, arithmetic completeness.
- `graft.test.ts` — vetoes, `noEvidencedPath`, graft lanes.
- `pipeline.test.ts` — seeded graph end to end, including **the same evidence producing different recommendations for a week horizon and a year horizon**.
- `extract.test.ts` — a passing build is never treated as a decision, and never attached to the taken path.

---

## Known gaps

1. **In-Jira rendering unconfirmed.** The deployed modules have not been observed mounting. The standalone host exists so the product can be reviewed regardless.
2. **Live graph validation.** No call has been made against a real Teamwork Graph. Relationship names in `queries.ts` are written from docs and must be checked in [TWG Labs](https://teamwork-graph.atlassian.com/query-builder).
3. **Query registration** has no CLI entry point in Forge 15; it needs a webtrigger or admin page.
4. **Dossier writer** and **Bitbucket trigger** are designed but unbuilt.
