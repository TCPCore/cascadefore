# Submission pack

Everything a reader needs, in the order they will read it. **Every claim here is
marked as verified or unverified**, and the unverified ones say so in the same
sentence. A submission that overstates is worse than a smaller true one.

## Evaluation paths

Two ways to check this, in order of effort:

| Path | Needs | What you see |
|---|---|---|
| **A — sandbox (60 seconds)** | Node only | `CASCADE_SOURCE=live CASCADE_STORE=sqlite npx tsx scripts/serve.ts` → the full product, no account |
| **B — installed in Jira** | An Atlassian site | Apps → Cascade → case base, reconstruction, projection |

Details: [INSTALL.md](INSTALL.md). The sandbox runs the *same* engine and the same
panel bundle the Forge app serves.

## Demo video

`artifacts/video/demo.webm` — 95 seconds, 1080p, captioned, recorded from the
running product (`node scripts/record-demo.mjs`). Beats: the decision matrix → a
decision's paths not taken → reconstruction → the tree projected at two anchors →
the forensic timeline.

---

## Name

**Decision as Code**

## Tagline

Every architecture decision becomes a testable artefact with a lifecycle, so the
agent's memory contains only decisions that survived contact with the codebase —
and it reconstructs decisions from the threads teams already wrote and forgot.

## Track

**Apps for Software Teams**

## Bonus categories — claimed and evidenced

| Category | What we can actually show |
|---|---|
| **Best Agents** | `rovo:agent` + `rovo:skill` (`decision-autopsy`) declaring four typed actions: `reconstruct-decision`, `project-tree`, `find-precedent`, `decision-matrix`. The agent prompt encodes the counterfactual protocol (never judge a path without precedent; state what was knowable) |
| **Best app with Atlassian MCP** | ✅ **verified end to end.** `tools/list` → `reconstruct-decision`, `get-run`, `project-tree`, `find-precedent`, `decision-matrix`, `health`. A real call ran the pipeline, wrote Forge SQL, and `get-run` read it back on a later invocation |
| **Best Teamwork Graph integration** | ✅ read integration verified: `JiraIssue` by ARI, `jira_space_has_jira_work_item`, `ConfluencePage`, `document_has_comments` **with comment bodies**. ⚠️ **Not** outcome attribution — no work-item→build edge exists, so we do not claim it (see [GRAPH-BOUNDARY](GRAPH-BOUNDARY.md)) |
| **Best Marketplace published app** | Free listing; install-link identity separate from the licensed listing identity — prepared, not yet published |

---

## The one-paragraph version

Architecture decisions are written down once and then rot silently — the code
drifts, nobody notices, and the next team repeats the argument. Decision as Code
makes the decision an assertion: a `.decisions/*.decision` file carrying a
machine-checkable test, run in CI, publishing a commit status per decision. A
Forge app keeps the case base, and reconstructs decisions that were never
recorded as decisions at all — from the threads teams actually wrote.

The demo is not a fixture. It reconstructs a decision from
[Confluence page 2129941](https://one-atlas-xoan.atlassian.net/wiki/spaces/MD/pages/2129941),
where three people resolved "should Finance be on the list?" in prose in 2022.
The reconstruction reports `evidenceSource: real_confluence_thread`, so a reader
can tell a real thread from a seeded one without trusting the author.

---

## What is novel (precise)

> A decision artefact whose own test observes whether it is still true — so the
> agent's library contains only decisions that survived contact with the code,
> and a decision is recovered from the prose a team already wrote.

| Component | Prior art | What is new here |
|---|---|---|
| Decisions as documents | ADR (Nygard, 2011) | not new |
| Decisions as **tests** | — | new: the decision is a runnable assertion |
| Policy as code | OPA, Sentinel | different object: rules vs choices with alternatives |
| Case-based reasoning | Schank & Kolodner, 1983 | not new |
| Executable case base | — | new: CBR over mechanically observed outcomes |
| **Decision recovery from prose** | — | new: thread clustering + resolution detection turns a Confluence thread into one decision with positions |
| **Projected tree** | — | new: the tree is computed from the index at a chosen date, never stored; `invisibleAfter` marks what could not have been known |
| **Time-gated precedent** | — | new: a rejected alternative is compared against precedent that existed at decision time, separate from what was learned afterwards |

---

## The methodology finding — five instances of one failure class

Every schema assumption the documentation contradicted produced output that
looked plausible and was silently wrong:

| # | Assumption | What it produced | Caught by |
|---|---|---|---|
| 1 | the label is `JiraWorkItem` | a query that runs | execution |
| 2 | properties are filterable | rows that return | execution |
| 3 | an unknown relationship returns empty | a query that "succeeds" | execution |
| 4 | a comment's identity is its name | three identical "threads" | branch-label distinctness test |
| 5 | provenance can be configured | a fixture labelled `real_confluence_thread` | source-declares test |

**Plausible output is not evidence. An assertion is.**

The fifth one is our own code, not the platform's: `evidenceSource` was first an
environment override, so it could describe a run as something it was not. It is
now declared by the data source, and a test asserts a caller cannot relabel it.

---

## Verified vs unverified

| Capability | Status |
|---|---|
| MCP: `tools/list`, `reconstruct-decision`, `get-run`, `health` | ✅ executed |
| Forge SQL: schema DDL, inserts, reads, column migrations | ✅ round-tripped |
| Pipeline in the Forge runtime | ✅ produced a run with 4 decisions |
| Teamwork Graph: issue by ARI, space edge, pages, page comments with bodies | ✅ executed in TWG Labs |
| Thread clustering + resolution detection on real comments | ✅ 1 decision, 3 positions, resolution taken |
| Runner CLI, commit statuses, exit code on violation | ✅ 162+ tests and a live run |
| Confluence mirror: render, sync, storage round trip, ingest | ✅ tested; REST adapter **not** exercised live |
| `jira:issuePanel` / `issueContext` mounting | ❌ **never observed** |
| `asUser()` inside a resolver (graph reads from the panel) | ❌ **untested** |
| Jira→comment, Jira→build, page→issue edges | ❌ **fail to plan** — excluded from the catalog |

---

## Honest limitations, stated first

0. **The Rovo agent has not been invoked from a chat surface.** Its actions and
   prompt are deployed and declared, but the only verified agent path is MCP.
   Treate the agent as declared-and-wired, not field-tested.
1. **The Jira panel mounted on 2026-11-04** — Apps → Cascade renders the case base.
   The earlier zero-invocation problem was a stale install at version 2; the app
   has since been upgraded. Historical note kept for honesty. Zero invocations before MCP proved the app
   runs. The 2026 work-item view hides app surfaces behind a manual "Apps" panel
   ([ECO-1643](https://jira.atlassian.com/browse/ECO-1643), declined). The product
   does not depend on it: MCP and SQL are verified.
2. **Graph reads need a browser context.** The MCP gateway supports 22 scopes and
   **none are `read:graph:*`**, so `asUser()` graph calls are impossible over MCP;
   `asApp()` is rejected by the graph endpoint. Whether a resolver gets a user
   session is the open question.
3. **The graph cannot attribute outcomes.** No path exists from a work item to a
   build. Attribution lives where both ends are ours: the runner publishes
   `decision/<id>`, the ledger records what was observed.
4. **Testability ceiling.** Roughly 40–60% of decisions admit a distinguishing
   test. The rest are orphaned, and the orphan rate is reported.
5. **Retrieval is structural, not semantic** — matched on domain, constraint and
   terms, with reasons, and it will not find a conceptually similar case that
   shares no vocabulary.
6. **No `shell` in Forge.** Shell tests run in the pipeline, where shell exists.

---

## Rubric mapping

| Criterion (20%) | Where it is demonstrated |
|---|---|
| **Technological Implementation** | MCP round trip verified; portable SQL ledger with migrations; persisted Cypher against a real graph; thread clustering and resolution detection; 166 tests |
| **Design** | case base (growth curve, patterns, precedent); reconstruction tree with then/now and graft lanes; provenance stamped on every run |
| **Potential Impact** | decisions rot silently; most are already written down but never made checkable, and the orphan rate is itself a finding |
| **Innovation** | decisions as executable assertions; decision recovery from prose; a case base of what *held* |
| **Presentation** | 2:30 video, six beats, one verifiable source page |

---

## Numbers to quote (all checkable in the repo)

```
245 tests · root + panel typecheck clean · forge lint clean
MCP: 6 tools; one verified round trip (reconstruct → SQL → get-run)
graph: 6 queries executed, 3 edges rejected
matrix: 6 decisions across 7 areas — 4 enforced, 1 violated, 1 orphaned
projection: same run at 2020 → 0 decisions; at 2026 → 4 in force
precedent: MongoDB @ 2026-03-14 → knownThen 0009 (held), learnedLater 0027 (reverted)
demo: 1 decision, 3 positions, resolution identified, evidenceSource: real_confluence_thread
case base: 4 enforced / 1 violated / 1 orphaned, growth 0.80 → 0.667 → 0.714
```

---

## Install instructions

```bash
git clone https://github.com/TCPCore/cascadefore
cd cascadefore && npm install && npm --prefix static/panel install

# Replay the real reconstruction
CASCADE_SOURCE=live npx tsx scripts/serve.ts     # → http://127.0.0.1:4173

# Or the case base with a SQL ledger
CASCADE_STORE=sqlite npx tsx scripts/serve.ts
```

No Atlassian account required to evaluate the product: the sandbox runs the same
engine, case base and ledger.

Forge side:

```bash
forge login
forge deploy -e development
forge install --demo-site -p Jira -e development --confirm-scopes
```

---

## Repository map

```
src/decisions/   artefact, parser, runner, retrieval, patterns, service, store, schema
src/runner/      load, executors (fs/http/graph), commit statuses, report
src/mirror/      page renderer, Confluence storage format, sync, ingest
src/attribution/ decision/<id> mapper (retained for a verified traversal)
src/graph/       query catalog (verified only), transport, decision synthesis, sandbox
src/domain/      time gate, scoring, intent policy, graft, projection, events
static/panel/    React: reconstruction tree, case base, outcome trail
scripts/         serve.ts, run-decisions.ts, render.ts, dump-queries.ts
docs/            PROJECT_PLAN, ARCHITECTURE, GRAPH-BOUNDARY, DEMO_SCRIPT, ...
```

## Licence

Apache 2.0.
