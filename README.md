# Cascade

Reconstructs the decision that seeded a failure, scores the paths that were evidenced at the time, and recommends the cheapest evidenced way back to the team's goal — every claim carrying an ARI.

Built for **Codegeist 2026** on Forge + Teamwork Graph. Submitted under **Apps for Software Teams**; entered for **Best Agents**, **Best app with Atlassian MCP**, **Best apps with Teamwork Graph integration**, and **Best Marketplace published app**.

> The failure wasn't a bad decision. It was an unconnected graph.

---

## The one idea

Teamwork Graph has no `Decision` object. Cascade synthesises decision nodes from four evidence classes — documented, threaded, transitional and implicit — then scores each recorded alternative on two axes:

| | Meaning | Computed from |
|---|---|---|
| `W_k` knowability | what the team could reasonably have known *at the time* | only evidence created on or before the decision date |
| `W_v` viability | what proved to work, judging by everything since | implementation proof (builds, deployments, PRs) and outcomes |

`gap = W_v − W_k`. A high gap means the organisation had the evidence and never connected it. That is the product.

The same evidence, scored against two different intents, produces two different recommendations — which is why the output is not hindsight bias.

---

## Status

Everything below was run on this machine; the "verified" column says how.

| Area | State | Verified by |
|---|---|---|
| Domain model, time gate, scoring, intent policy, graft assembly | done | 73 unit tests |
| Graph layer: persisted-Cypher catalog, paged client, decision synthesis | done | unit tests for synthesis + pagination mocks |
| Storage: DDL, statements, hydration, repository | done | typecheck + mapper tests |
| Pipeline: traverse → synthesise → score → rank → persist | done | 8 end-to-end tests on a seeded graph |
| Two-intent flip (`weeks` vs `years` → different recommendation) | done | pipeline test |
| Resolver + async consumer + action | done | typecheck |
| Custom UI panel (tree, then/now, graft, empty state) | done | `vite build` |
| `rovo:skill`, `rovo:agent`, `rovo:mcp` manifest + artifacts | done | typecheck; **not** `forge lint` |
| Seeded demo graph | done | used by the pipeline tests |
| **Live Teamwork Graph calls** | **not verified** | needs a dev site — see "Known gaps" |
| **Confluence dossier writer** | **hook only** | `writeDossier` dep exists, no implementation |
| **Bitbucket build-status trigger** | **not implemented** | scopes and event choice documented only |

`forge lint` has not been run: it needs an authenticated Forge CLI. Expect to fix a handful of manifest nits on first deploy.

---

## Quick start

### 0. Prerequisites

- Node 22 LTS (the Forge runtime is `nodejs22.x`; this repo was developed on Node 26)
- A free Atlassian Cloud developer site with Jira, Confluence and Bitbucket
- `npm i -g @forge/cli`

### 1. Install

```bash
npm install
npm --prefix static/panel install
npm run build:panel
```

### 2. Bind the app id

`manifest.yml` ships a placeholder:

```yaml
app:
  id: ari:cloud:ecosystem::app/00000000-0000-0000-0000-000000000000
```

Run `forge create` (or `forge register` on this directory) and paste the real id. Nothing else in the manifest needs editing.

### 3. Deploy and install

```bash
forge deploy
forge install --site <your-site>.atlassian.net --product Jira
```

The install asks for **organisation administrator** consent, because Teamwork Graph scopes are org-wide. That is expected.

### 4. Register the persisted Cypher queries

```bash
forge invoke --function register-queries
```

This is idempotent (identical Cypher returns the original `queryKey`). It prints three keys. Put them in the app environment:

```bash
forge variables set CASCADE_QUERY_SPINE     <key>
forge variables set CASCADE_QUERY_BRANCHES  <key>
forge variables set CASCADE_QUERY_OUTCOMES  <key>
forge deploy
```

Keys take **about a minute** to propagate. A run started immediately after registration will retry and then succeed; that is the transport treating `QUERY_NOT_FOUND` as retryable.

> ⚠️ **Before step 4, verify the Cypher.** The relationship type names in `src/graph/queries.ts` are the least stable part of the Preview schema. Paste each query into [TWG Labs](https://teamwork-graph.atlassian.com/query-builder) and fix the names there first. Nothing outside `queries.ts` depends on them.

### 5. Run without a graph (demo mode)

```bash
forge variables set CASCADE_DEMO_MODE true
forge deploy
```

This swaps the real graph source for a seeded scenario (`src/demo/seedSource.ts`) with one billing decision, two alternatives, and two passing builds. The whole pipeline runs for real; only the data is fixed. Use this to develop the UI, to record the demo, and as a fallback if the Preview API misbehaves on the day.

---

## How it works

```
jira:issuePanel ──invoke──▶ resolver.startCascade ──▶ Queue ──▶ reconstruct job
                                                                    │
                                    ┌───────────────────────────────┤
                                    ▼                               ▼
                          Teamwork Graph (read-only)          Forge SQL
                          persisted Cypher × 3                runs/nodes/
                                    │                          evidence/branches/paths
                                    ▼
                          decision synthesis (rules)
                                    ▼
                          scoring (pure, tested)  ──▶ snapshot ──▶ panel polls getRun
```

- **Read-only by design.** The Teamwork Graph API has no write path, so the dossier is a Confluence page (ingested by the graph afterwards), not a graph mutation.
- **No model in the scoring path.** `src/domain/**` may not import `@forge/llm`. The model is confined to intent parsing, and even there every hard constraint must be literally grounded in the user's text or it is dropped.
- **Async by necessity.** Resolvers get 25 seconds; the reconstruction runs on an async consumer and the panel polls, so traversal size is not bounded by a resolver timeout.

### File map

| Path | Responsibility |
|---|---|
| `src/domain/` | time gate, scoring, intent policy, graft assembly — pure, no I/O |
| `src/graph/queries.ts` | persisted Cypher catalog + scope table |
| `src/graph/client.ts` | cursor paging, error classification, GraphQL envelopes |
| `src/graph/extract.ts` | decision synthesis rules, spine/branch assembly |
| `src/graph/source.ts` | rows → artefacts; scope probe |
| `src/pipeline/run.ts` | orchestration with injected dependencies |
| `src/storage/` | DDL, persistence statements, hydration, repository |
| `src/resolvers/` | `startCascade`, `getRun`, `health` |
| `src/jobs/` | async consumer |
| `src/actions/` | the single action exposed to Rovo Agent and MCP |
| `static/panel/` | React panel (Vite) |
| `skills/decision-autopsy/` | `SKILL.md` + scoring rubric |
| `docs/` | forensic platform analysis + technical blueprint |

---

## Tests

```bash
npm test          # 73 tests
npm run typecheck # tsc --noEmit
```

The suite that matters:

- `tests/timeGate.test.ts` — the hindsight-bias defence, including clock skew and unparseable timestamps.
- `tests/scoring.test.ts` — independence discounting, withheld evidence scoring zero knowability, arithmetic completeness.
- `tests/graft.test.ts` — vetoes, `noEvidencedPath`, graft lanes.
- `tests/pipeline.test.ts` — the seeded graph end to end, including **the same evidence producing different recommendations for a week horizon and a year horizon**.
- `tests/extract.test.ts` — synthesis rules, including that a passing build is never treated as a decision and is never attached to the taken path.

---

## Known gaps

1. **Live graph validation.** No call has been made against a real site. Week 1 of the build plan is a spike: run `echo`, register one query, confirm scopes. Expect the relationship names in `queries.ts` to need correction.
2. **Dossier writer.** `runPipeline` accepts a `writeDossier` dependency and degrades gracefully if it throws, but no Confluence implementation exists. Needed for the full "write into the graph" story.
3. **Bitbucket trigger.** The event (`avi:bitbucket:updated:build-status`, scope `read:repository:bitbucket`) is chosen and documented, but no subscription or handler is wired. Until then, runs start from the panel button.
4. **`forge lint`.** Not run. Manifest module shapes are written from the docs, not from a successful deploy.
5. **`surprise_map`.** Designed in the blueprint, cut from the build. It is the highest-emotion feature and the first thing to add back if there is time.

## Next three moves

1. Spike the graph: `echo` → one persisted query → confirm scopes, then fix `queries.ts`.
2. Implement the Confluence dossier writer (`src/graph/dossier.ts`) behind the existing hook.
3. Wire the Bitbucket build-status event to auto-open the panel with the failing commit pre-loaded.
