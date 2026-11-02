# Cascade — Technical Breakdown

**As built, 2 Nov 2026.** 6,499 lines across `src/`, `tests/`, `static/panel/src/`, `scripts/`.
73 tests, `tsc --noEmit` clean, Forge v2.3.0 on production, Runs-on-Atlassian eligible.

---

## 1. What the system does

Given an **event** — a failed build, an incident, a deployment, a closed task, a release, a service change — Cascade reconstructs the decision path that made it possible, scores each recorded alternative by *what was knowable at the time* against *what proved viable since*, and projects what taking an alternative would invalidate.

It never predicts. Every claim is either observed precedent (a build that passed somewhere) or arithmetic over graph structure, and the UI labels which.

---

## 2. Repository topology

```
manifest.yml                 Forge app: 5 module types, 15 scopes
src/
  shared/    types.ts dtos.ts ids.ts      contracts, no logic
  domain/    timeGate scoring intent graft projection events constants math
  graph/     queries client extract source registerQueries
  pipeline/  run.ts                        orchestration, dependency-injected
  storage/   schema runs driver forgeDriver
  resolvers/ index.ts                      startCascade / getRun / health
  jobs/      reconstruct.ts                async consumer
  actions/   runCascade.ts                 rovo:action handler
  llm/       intentParser.ts               the only model call
  demo/      seedSource.ts                 deterministic graph fixture
  bootstrap.ts config.ts
static/panel/  React 18 + Vite, builds twice (Forge + standalone)
scripts/       serve.ts (HTTP host), render.ts (offline report), set-app.mjs
tests/         6 files + fixture
skills/decision-autopsy/  SKILL.md + references/scoring-rubric.md
resource/agent/prompt.txt
docs/          forensic analysis, blueprint, environment review, this file
```

Dependency direction is strictly inward: `domain/` imports nothing but `shared/`. No I/O, no Forge SDK, no React. That is what makes it testable in 700 ms.

---

## 3. Runtime topology

Three hosts, one engine.

| Host | Entry | Transport | State |
|---|---|---|---|
| **Forge (Jira)** | `jira:issueContext` + `jira:issuePanel` | `@forge/bridge` → resolver → pipeline | Forge SQL |
| **Forge (agent/MCP)** | `rovo:agent` → `rovo:skill` → `action` | direct function call | Forge SQL |
| **Standalone** | `scripts/serve.ts` on :4173 | `fetch` → `/api/*` | in-memory Map |

The panel picks its transport at runtime in `static/panel/src/api.ts`; everything above that file is host-agnostic. `@forge/bridge` is a **lazy dynamic import**, so a plain browser never evaluates it — that is what made the standalone host possible and cut the main bundle from 224 kB to 161 kB.

Run-mode switches (Forge variables):

| Variable | Effect |
|---|---|
| `CASCADE_DEMO_MODE=true` | swap the real graph for the seeded fixture |
| `CASCADE_INLINE=true` | run the pipeline inside the resolver instead of the async consumer |
| `CASCADE_QUERY_SPINE/_BRANCHES/_OUTCOMES` | persisted-Cypher keys |
| `CASCADE_LLM_MODEL` | Forge LLM model tier (default `sonnet`) |

---

## 4. Domain model

```ts
Evidence       { ari, type, createdAt, sourceAuthority, independenceKey,
                 implementationProof, outcome, supersededAt? }
DecisionNode   { id, ari, kind: documented|thread|transition|implicit,
                 title, decidedAt, actorAris[], confidence, evidence[] }
Branch         { id, nodeId, label, taken, evidence[], downstreamNodeIds[],
                 requiredDependencies[], unwindsNodeIds[] }
SpineSegment   { nodeId, ari, title, order, dependentCount, resolved }
BranchScore    { knowability, viability, gap, confidence,
                 knowableEvidenceAris[], withheldEvidenceAris[], arithmetic[] }
Projection     { headline, evidenced, observedOutcome, precedentAris[],
                 invalidates[], retains[], dependentObjects, confidence, timeline[] }
EventContext   { kind, subjectKey, subjectAri, title, at }
```

Invariants enforced by construction:

- a branch with zero evidence is unrepresentable as a scored branch, so it cannot render;
- an orphan branch (node id not in the node set) is dropped in `scoreBranches`, never rendered;
- `implicit` node confidence is capped at 0.85 — absence of evidence is weaker than evidence of absence;
- `decidedAt` is always ≤ the event timestamp.

---

## 5. Algorithms

### 5.1 Time gate — the hindsight defence

```
knowable(e, node) ⇔ parse(e.createdAt) ≤ parse(node.decidedAt)
```

Fails closed on unparseable timestamps. Four lines, no heuristics, and it is the entire answer to "isn't this hindsight bias?".

### 5.2 Knowability and viability

Both aggregate identically so the comparison is fair:

```
recency(e, node)        = clamp(exp(−ageDays / 180), 0.20, 1.00)
independence(e)         = 1 / sqrt(count of evidence sharing e.independenceKey)

W_k = clamp01(Σ authority(e) × recency(e) × independence(e))     [knowable only]
W_v = clamp01(Σ field(e) × outcome(e) × independence(e))

field(e)   = implementationProof ? 1.00 : authority(e) × 0.50
outcome(e) = passed 1.00 · failed 0.15 · unknown 0.60
```

`independenceKey` is the author, else the component, else the artifact ARI. Four comments from one reviewer are not four facts.

`gap = W_v − W_k`. Positive gap = the organisation had the evidence and never connected it. Negative gap = the path looked fine at the time; a healthy, honest result.

Every score emits `ArithmeticStep[]` so the UI can show the actual sum rather than a number.

### 5.3 Path score (forward recommendation)

```
weights by horizon:  weeks {.60,.25,.15}  quarters {.40,.40,.20}  years {.15,.65,.20}

intentFit = 1 − (w.migration·migrationCost + w.residual·residualRisk + w.freshness·(1−freshness))
score     = (intentFit × applicability − (migrationCost + residualRisk)) × freshness
```

- `migrationCost` = dependent objects unwound ÷ 8, capped at 1
- `residualRisk` = unresolved retained segments ÷ 5, capped at 1
- `applicability` = share of required dependencies still resolvable
- `freshness` = share of branch evidence not superseded

Hard-constraint **vetoes** are separate from deductions: tagged constraints (`#no-new-dependency`, `#ship-within-2-weeks`, `#no-schema-change`, `#no-downtime`) can disqualify a path outright. Untagged constraints never veto — they are reported as unmapped rather than guessed at.

### 5.4 Graft assembly

Not a revert. Three lanes from the divergence point: **keep** (prefix that survives), **graft** (the chosen branch), **unwind** (contradicted segments with dependent counts). If every path is vetoed, the result is `noEvidencedPath` naming the failing criterion — a first-class outcome, not an error.

### 5.5 Projection

Two halves, deliberately never merged:

- **observed precedent** — `implementationProof` evidence: a build/deployment that succeeded (or failed) on that path, with ARIs;
- **structural consequence** — which spine nodes the branch invalidates, how many dependent objects move, what survives.

`evidenced=false` when there is no precedent. The UI shows `no precedent` and claims nothing beyond structure.

---

## 6. Pipeline

`runPipeline(input, deps)` — every external dependency injected, so the whole thing runs in a test with a fake graph.

```
parse intent  →  source.collect(workItemKey)
              →  assemble(artifacts)            // synthesis, no LLM
              →  scoreBranches(nodes, branches) // pure
              →  buildPaths → rankPaths → decide
              →  projectBranch × N
              →  buildSnapshot → SQL
```

Stage callbacks (`onStage`) let the async consumer persist progress (`traversing → extracting → scoring → ranking → persisting`).

Failure handling: graph error → `status:'failed'` with the code; no decisions → `status:'empty'` **plus a scope probe**, because an empty Teamwork Graph result means either "no data" or "scope not granted" and the two are indistinguishable without probing.

---

## 7. Graph layer

**`queries.ts`** — three persisted-Cypher specs (`spine`, `branches`, `outcomes`) plus `SCOPE_FOR_OBJECT_TYPE`, an 18-entry object-type → scope map that doubles as the probe source.

**`client.ts`** — the transport. Handles the two traps that break naive implementations:

- `first` is capped at **25**, and permission filtering happens *after* paging, so a page can return fewer rows than requested and still have more. Loops are driven by `hasNextPage`, never row count.
- `QUERY_NOT_FOUND` is expected for ~1 minute after registration. It is classified retryable with backoff; `NOT_OWNER` / `FEATURE_UNAVAILABLE` are fatal.

**`source.ts`** — maps rows to `RawArtifact`, normalised so a Cypher relationship rename never reaches the extractor. Also `probeScopes`, which asks the graph for one row of each object type and reports which types came back.

**`extract.ts`** — decision synthesis, the intellectual core:

| Artifact | Rule | Confidence |
|---|---|---|
| Confluence page with ADR title **and** options section | `documented` | 0.90 |
| Confluence page, ADR title only | `documented` | 0.75 |
| Confluence page, options section only | `documented` | 0.70 |
| Comment thread ≥3 replies with resolution marker | `thread` | 0.60 + 0.05·replies, ≤0.80 |
| Comment thread ≥3 replies, unresolved | `thread` | 0.55 |
| Jira status transition | `transition` | 0.50 |
| Builds, deployments, PRs, goals | **never a decision** | — |

Then `assemble()` builds the spine (newest decision first, capped at 6 deep), one taken branch per area, up to 3 alternatives each, and attaches external build/deployment artifacts to **alternative** branches only — a passing build is proof about a path not taken, never credit for the path taken.

---

## 8. Storage

Five tables, prefixed `cascade_`, no foreign keys (unsupported by the engine).

```sql
cascade_runs       (run_id PK, work_item_key, failure_at, status, stage,
                    event_json, intent_json, spine_json, recommendation_json,
                    stats_json, scope_probe_json, dossier_url, error_code, …)
cascade_nodes      (run_id, node_id PK, ari, kind, title, decided_at, confidence, evidence_count)
cascade_evidence   (run_id, ari PK, node_id, type, title, created_at,
                    authority, independence_key, proof, outcome)
cascade_branches   (run_id, branch_id PK, node_id, label, taken, score_json)
cascade_paths      (run_id, path_id PK, branch_id, rank_no, score, disqualified, path_json)
```

Persistence strategy: pure builders (`persistStatements`, `hydrate`) separated from the driver, so both are testable without a database. `score_json` stores `{ score, projection, consequence }` with backward-compatible hydration for the older bare-`BranchScore` shape.

`ensureSchema` runs `CREATE TABLE IF NOT EXISTS` once per cold start, then **column migrations** (`ALTER TABLE … ADD COLUMN event_json`) best-effort — `CREATE TABLE IF NOT EXISTS` can never alter an existing table, which is exactly the trap that would have silently dropped the event field.

---

## 9. Surfaces

| Surface | Module | Behaviour |
|---|---|---|
| `jira:issueContext` | right-column panel | renders automatically, no menu click |
| `jira:issuePanel` | full-width panel | behind ••• → Apps |
| `function resolver` | `startCascade`, `getRun`, `health`, `defaultIntent` | creates run, enqueues or runs inline, serves snapshots |
| `consumer` | `cascade-jobs` | async reconstruction, ≤900 s |
| `action reconstruct-decision` | `rovo:action` | 55 s budget, used by agent **and** MCP |
| `rovo:agent` | Cascade | prompt as resource, skill + action wired |
| `rovo:skill` | decision-autopsy | `SKILL.md` + scoring rubric, ≤500-line body |
| `rovo:mcp` | one module, one tool | external clients at `mcp.atlassian.com/forge/<appId>` |
| `sql` | mysql engine | 1 GiB/install |

Standalone HTTP (not Forge): `GET /api/health`, `POST /api/runs`, `GET /api/runs/:id`, static SPA with fallback.

---

## 10. UI

`App.tsx` — state machine `idle → working → done | error`; intent form (goal, **event kind**, horizon); polls `getRun`; three tabs.

`DecisionExplorer.tsx` — the tree. Spine rendered forward (root→event) or backward (event→root). Each node lists its alternatives; selecting one:
- shows the projection card (evidenced flag, observed outcome, five metrics, consequence lines, evidence timeline);
- strikes through every downstream node the selection invalidates;
- keeps the recommendation highlighted by default.

`ThenNow.tsx` — two columns, `W_k` vs `W_v` per branch; the visual form of the hindsight defence.
`Graft.tsx` — keep / graft / unwind lanes, alternates list, `noEvidencedPath` state.
`EmptyState.tsx` — scope-probe table, because an empty graph and an ungranted scope look identical.

CSS is 875 lines of hand-written tokens — no UI kit, no framework.

---

## 11. Build & deploy topology

Two Marketplace identities, one codebase (`scripts/set-app.mjs`):

| Identity | Licensed | Distribution | Purpose |
|---|---|---|---|
| `cascade-demo` | no | Sharing | install link for judges |
| `cascade-mkt` | yes | listing | Marketplace bonus + review ticket |

Two panel builds from one source:

```bash
npm run build:panel   # → static/panel/build      (Forge Custom UI)
npm run build:web     # → static/panel/build-web  (standalone)
```

`VITE_STANDALONE=true` sets `__STANDALONE__`, which selects the transport and output directory.

Environments: `development`, `staging`, `production` — production currently at 2.3.0.

---

## 12. Test strategy — 73 tests

| File | What it proves |
|---|---|
| `timeGate.test.ts` (8) | gate semantics incl. exact-instant, clock skew, unparseable input |
| `scoring.test.ts` (8) | independence discounting, withheld→zero knowability, clamping, arithmetic completeness, orphan drop |
| `graft.test.ts` (9) | veto logic, `noEvidencedPath`, unmapped constraint naming, graft lanes |
| `intent.test.ts` (17) | tag extraction, horizon detection, grounded-constraint filtering, weight divergence |
| `extract.test.ts` (23) | every synthesis rule, builds-are-not-decisions, proof attaches to alternatives only, assembly ordering |
| `pipeline.test.ts` (8) | end-to-end on the seeded graph, **two-intent divergence**, empty vs failed, dossier failure tolerated |

The two-intent test is the entry's spine: identical evidence, `weeks` vs `years`, different recommendation, neither disqualified.

---

## 13. Verified vs unverified

**Verified:** engine, scoring, projection, pipeline, storage mappers, panel build, standalone host, Forge lint, Forge deploy, production install, Runs-on-Atlassian eligibility.

**Unverified:** every Jira runtime path. `forge logs` shows **zero invocations** — no module has ever mounted. Teamwork Graph has never been called. Forge SQL has never executed. The Rovo agent/skill/MCP have never been exercised.

**Not built:** Confluence dossier writer (hook exists), Bitbucket build trigger (needs a separate workspace-scoped app), query registration (no `forge invoke` in CLI 15).

---

## 14. Known debt

1. `static/panel/src/components/Tree.tsx` is **dead code** — superseded by `DecisionExplorer`.
2. `registerQueries.ts` has no invocation path; it would need a webtrigger (costs the RoA badge) or an admin page.
3. `hydrate` carries a backward-compatible branch on the old `score_json` shape; remove once no old runs exist.
4. Custom UI in the right rail is cramped at ~350 px; the explorer was designed at full width.
5. `probeScopes` issues one raw query per object type — fine at 8 types, wasteful at 18.
6. No pagination cap test for the `truncated` path in `runPersistedQuery`.
