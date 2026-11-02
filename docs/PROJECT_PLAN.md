# Decision as Code — Project Plan & Task Registry

**Repo:** https://github.com/TCPCore/cascadefore · **Deadline:** 22 Dec 2026, 12:00 PT
**Owner:** cptlight · **App id:** `ari:cloud:ecosystem::app/1fcb1899-1194-47c1-a794-26e4d3e59e0f`
**Status legend:** `[ ]` todo · `[~]` partial · `[x]` done · `[!]` blocked

> This file is the single source of truth. Update it as work happens; never leave it stale.
> One task = one small, reviewable change. If a task needs another task, it lists it under **Deps**.

---

## 1. Product in one paragraph

**Decision as Code** turns every architecture decision into a `.decisions/*.decision` file with an executable test, a computed status (`enforced | violated | orphaned`), and an outcome trail. Tests run in Bitbucket Pipelines on push. Results travel to Atlassian two ways: commit statuses become Teamwork Graph objects (the outcome ledger, synced by Atlassian for free), and a Confluence mirror carries the decision definition. A single Jira+Confluence Forge app reads both, builds a **case base** of decisions-that-held, retrieves precedent for new decisions, and exposes it through Jira, a Rovo agent, and MCP. The agent's memory is executable: it contains only decisions that survived contact with the code.

## 2. Non-goals (explicitly out of scope for v1)

- No semantic embeddings / vector search. Retrieval is structured (domain + constraints + terms).
- No `shell` execution inside Forge. Shell lives in Pipelines only.
- No shared database between apps. One app owns the case base.
- No Bitbucket app, no workspace scope in the Forge app.
- No real-time push into Jira. Attribution is read from the graph on demand.
- No multi-repo federation beyond what a single Confluence space + graph site already give.
- No decision *prediction*. The agent retrieves precedent; it never forecasts outcomes.

## 3. Architecture (final)

```
.decisions/*.decision        repo (source of truth for decision + tests)
        │ push / PR
        ▼
decisions-runner (Pipelines)   parse → run file_match/shell/http → emit
        │
        ├── commit status "decision/<id>"  →  Teamwork Graph ExternalBuild
        └── Confluence space record         →  definitions + last status
                                               │
        ┌──────────────────────────────────────┘
        ▼
forge-app (Jira + Confluence, ONE app, Runs-on-Atlassian)
   read Confluence      → decisions (definitions + status)
   read Teamwork Graph  → outcomes + attribution (decision → PR → build → incident)
   own Forge SQL        → case base (retrieval, patterns, Laplace confidence)
   surfaces             → Jira panel · Confluence byline · Rovo agent · MCP (4 tools)
```

The join key is the decision id, embedded in the commit-status name. No shared DB, no cross-app calls, no repo read from Jira.

---

## 4. Epics and tasks

### E0 — Foundation & environment

| ID | Task | Status | Effort | Deps |
|---|---|---|---|---|
| DAC-001 | Provision nvm + Node 24 + Forge CLI; fix `npm_config_prefix` | [x] | 0.5d | — |
| DAC-002 | `forge login`, `forge register`, three environments | [x] | 0.5d | DAC-001 |
| DAC-003 | Repo hygiene: `.gitignore`, git identity, push to origin | [x] | 0.5d | — |
| DAC-004 | Manifest compiles: handler paths, `noEmit`, sql engine, scope split | [x] | 1d | DAC-002 |
| DAC-005 | Deploy to production + install Jira/Confluence on demo site | [x] | 0.5d | DAC-004 |
| DAC-006 | Standalone host (`scripts/serve.ts`) + offline report + web bundle | [x] | 1.5d | DAC-004 |
| DAC-007 | Environment review + spike docs committed | [x] | 0.5d | — |

**Gate E0:** `npm run verify` green; app deploys; standalone host serves on :4173. ✅

### E1 — Decision artifact & parser

| ID | Task | Status | Effort | Deps |
|---|---|---|---|---|
| DAC-010 | `.decision` schema + types (`src/decisions/types.ts`) | [x] | 0.5d | — |
| DAC-011 | YAML parser + fenced-block extraction + validation errors | [x] | 1d | DAC-010 |
| DAC-012 | Test-kind union (`file_match/shell/http/graph/manual`) | [x] | 0.5d | DAC-010 |
| DAC-013 | Parser unit tests (valid, invalid, status-never-authored) | [x] | 0.5d | DAC-011 |
| DAC-014 | Seed corpus: 5 decisions, ordered for a moving growth curve | [x] | 0.5d | DAC-011 |

### E2 — Runner & test execution

| ID | Task | Status | Effort | Deps |
|---|---|---|---|---|
| DAC-020 | Executor registry + `statusOf` lifecycle (enforced/violated/orphaned) | [x] | 1d | DAC-010 |
| DAC-021 | `runDecision`/`runAll` with `skipped` semantics for missing executors | [x] | 1d | DAC-020 |
| DAC-022 | `file_match` executor (fixture) | [x] | 0.5d | DAC-020 |
| DAC-023 | `graph` executor against Teamwork Graph (`customQuery`) | [x] | 1d | DAC-040 |
| DAC-024 | `http` executor | [x] | 0.5d | DAC-020 |
| DAC-025 | **decisions-runner** CLI (`scripts/run-decisions.ts`): glob `.decisions/`, run, report | [x] | 1.5d | DAC-021 |
| DAC-026 | Emit Bitbucket commit status `decision/<id>` from the runner | [x] | 0.5d | DAC-025 |
| DAC-027 | `bitbucket-pipelines.yml` step wiring the runner | [x] | 0.5d | DAC-026 |
| DAC-028 | Confluence mirror: page renderer, idempotent sync, storage-format round trip (**REST adapter pending**) | [~] | 1d | DAC-025 |
| DAC-029 | Runner unit + e2e tests against a fixture repo | [x] | 1d | DAC-025 |

**Gate E2:** push to a fixture repo → commit statuses appear → Confluence shows the decision record. (Screenshot.)

### E3 — Case base (retrieval + patterns)

| ID | Task | Status | Effort | Deps |
|---|---|---|---|---|
| DAC-030 | `DecisionContext` + structured similarity + `findSimilar` | [x] | 1d | DAC-010 |
| DAC-031 | Laplace confidence + ratio-guarded pattern extraction | [x] | 1d | DAC-030 |
| DAC-032 | `growthCurve` over decision-ordered prefixes | [x] | 0.5d | DAC-031 |
| DAC-033 | Retrieval/pattern unit tests (curve shape, guards) | [x] | 0.5d | DAC-031 |
| DAC-034 | Forge SQL schema for `decisions`, `outcomes`, `patterns` (portable DDL) | [x] | 1d | DAC-040 |
| DAC-035 | Case-base repository (insert/query) + schema bootstrap | [x] | 1d | DAC-034 |
| DAC-067 | Adopt `migrationRunner.run()` from `@forge/sql` instead of hand-rolled `ensureSchema` | [ ] | 0.5d | DAC-034 |
| DAC-036 | Ingest: Confluence mirror → case base (parser + round-trip done, **REST read pending**) | [~] | 1d | DAC-028, DAC-035 |
| DAC-037 | Case-base UI: list, status, growth curve, "similar to this" | [x] | 1.5d | DAC-033 |

**Gate E3:** 4 decisions retrieve ≥2 similar + 1 pattern; a violation moves confidence. Demoable on :4173. (Screenshot.)

### E4 — Outcome attribution (Teamwork Graph)

| ID | Task | Status | Effort | Deps |
|---|---|---|---|---|
| DAC-040 | ~~Confirm TWG scopes~~ **confirmed: 15/15 Teamwork Graph scopes granted on site**; MCP tool call is the test harness (panel not required) | [~] | 0.5d | DAC-005 |
| DAC-041 | Persisted Cypher: `decision/<id>` status → PR → build → incident | [x] | 1.5d | DAC-040 |
| DAC-042 | Verify relationship names in TWG Labs; correct `queries.ts` | [ ] | 0.5d | DAC-041 |
| DAC-043 | Attribution UI: violated decision → linked downstream events | [ ] | 1d | DAC-041 |
| DAC-044 | Scope probe wired into the empty state | [~] | 0.5d | DAC-040 |

**Gate E4:** a violation links to a PR/build/incident object in the graph. (Screenshot.)

### E5 — Surfaces (Jira · Confluence · Rovo · MCP)

| ID | Task | Status | Effort | Deps |
|---|---|---|---|---|
| DAC-050 | Diagnose Jira panel mount — **resolved: panels are hidden behind a manual "Apps" panel by design** ([ECO-1643](https://jira.atlassian.com/browse/ECO-1643) "Not Being Considered") | [x] | 1d | DAC-005 |
| DAC-051 | Jira `issueContext` + `issuePanel` render decision status for the issue | [~] | 1d | DAC-050 |
| DAC-052 | Confluence byline item showing decision status on a page (**module added, component pending**) | [~] | 1d | DAC-040 |
| DAC-053 | Rovo agent "Decision Advisor" (prompt + skill + actions) | [~] | 1.5d | DAC-035 |
| DAC-054 | `record-decision`, `run-decision-test`, `find-similar`, `attribute-outcome` actions (2 of 4 resolvers) | [~] | 1d | DAC-035 |
| DAC-055 | `rovo:mcp` — 4 tools, admin-exposure documented | [~] | 0.5d | DAC-054 |
| DAC-056 | Standalone host parity (event selector already in place) | [x] | — | — |
| DAC-057 | `jira:dashboardGadget` — **Decision health** gadget (module + gadget auto-mode added) | [~] | 1.5d | DAC-035 |
| DAC-058 | `confluence:contentBylineItem` — decision status on the page byline (auto-renders) | [ ] | 1d | DAC-052 |
| DAC-059 | Demo script leads with Rovo agent + standalone host; Jira click-path shown honestly | [ ] | 0.5d | DAC-061 |

**Gate E5:** agent answers "is decision 0012 still followed?" with status + evidence + linked event. (60s video beat.)

### E6 — Demo, video, submission

| ID | Task | Status | Effort | Deps |
|---|---|---|---|---|
| DAC-060 | Seeder: plan + idempotent executor for ADR pages, issue, comment (**REST client pending**) | [~] | 1.5d | DAC-005 |
| DAC-061 | Video script (retrieve → pattern → grow → attribute) | [ ] | 1d | all gates |
| DAC-062 | Record + edit 3-min video, captions, 1080p | [ ] | 2d | DAC-061 |
| DAC-063 | Submission writeup mapping rubric to video timestamps | [ ] | 0.5d | DAC-062 |
| DAC-064 | Install-link app identity (`cascade-demo`) + distribution "Sharing" | [ ] | 0.5d | DAC-005 |
| DAC-065 | Marketplace listing identity (`cascade-mkt`) + review ticket | [ ] | 1d | DAC-064 |
| DAC-066 | Fresh-site install runbook validated by a stranger | [ ] | 0.5d | DAC-060 |

---

## 5. Milestones (50 days to deadline)

| Milestone | Tasks | Target date | Gate |
|---|---|---|---|
| M0 Foundation | E0, E1 | 2 Nov | ✅ done |
| M1 Runner | E2 | 6 Nov | E2 gate |
| M2 Brain | E3 | 9 Nov | E3 gate |
| M3 Attribution | E4 | 12 Nov | E4 gate |
| M4 Surfaces | E5 | 16 Nov | E5 gate |
| M5 Demo | E6 | 19 Nov | 3-min video |
| M6 Polish + submit | buffer | 21 Dec | submitted |

> Buffer is real: this week alone cost three days to environment issues (`.gitignore` bundle, `noEmit`, handler paths). Budget 1.5× per phase; M6 absorbs the overrun.

## 6. Definition of Done (a task is done only when)

1. Code reviewed and merged to `main`.
2. `npm run typecheck` and `npm test` pass.
3. For Forge code: `forge lint` clean; for UI: `npm run build:web` clean.
4. The acceptance criterion in the task row is met, with a screenshot or a test.
5. This file's status cell is updated in the same commit.

## 7. Falsifiers (pre-registered; if one fires, cut the feature)

| Falsifier | Task | Fire condition |
|---|---|---|
| Testability ceiling | DAC-020 | <6 of 10 real decisions expressible as a distinguishing test |
| Retrieval utility | DAC-033 | <50% of retrieved cases judged relevant across 10 decisions |
| Pattern stability | DAC-031 | >50% of patterns contradicted by the 4th case |
| Attribution sparsity | DAC-041 | <50% of violations link to a downstream graph event |
| Panel mount | DAC-050 | **FIRED** — panels require a manual "Apps" click (ECO-1643 declined). Mitigation: dashboard gadget + byline item + agent-led demo. |

## 8. Tracking convention

- **Sandbox-first:** no `forge deploy`/`forge install` against production until explicitly approved. All development happens in the local host (:4173 / :4174) and, when needed, the `development` environment.
- Work top-down through the table; commit messages reference task ids (`DAC-026: commit statuses`).
- A task moves `[ ] → [~] → [x]`; a `[!]` gets a one-line reason and its blocker id.
- Every Friday, or at each milestone, update this file and push before doing anything else.

---

## 9. Current snapshot (2 Nov)

**Done:** E0, E1, E2 core (registry/lifecycle/file_match fixture), E3 core (retrieval/patterns/growth), standalone host + decision UI foundation.
**Unblocked 2 Nov (scopes):** all 15 Teamwork Graph scopes + `write:jira-work` + `write:confluence-content` are granted on the site (admin → Connected apps → Authorization). Two consequences: the graph is testable *today*, and Teamwork Graph **connectors are unavailable on this site** ("No connectors available"), so the case base must live in Forge SQL + Confluence — which is already the design.

**Unblocked 2 Nov (UI):** DAC-050 resolved — panels are hidden behind a manual "Apps" panel in the 2026 work-item view; Atlassian declined a `defaultOpen` option (ECO-1643, "Not Being Considered"). See [JIRA_MOUNT_DIAGNOSIS.md](JIRA_MOUNT_DIAGNOSIS.md). Consequence: add a dashboard gadget (DAC-057) and a Confluence byline item (DAC-058) as first-run surfaces, and lead the demo with the agent + standalone host.
**Done since:** runner CLI + commit statuses + pipeline config (DAC-023…027, 029), portable case-base SQL + ledger store (DAC-034/035), case-base UI (DAC-037).
**Done since:** Confluence mirror renderer + idempotent sync + storage-format round trip (DAC-028), ingest parser + round trip (DAC-036), attribution query + mapper (DAC-041), dashboard gadget + byline modules (DAC-052/057), case-base resolvers.
**Next in queue:** REST adapters for mirror/ingest → dashboard gadget component → demo seeder (DAC-060) → video.
