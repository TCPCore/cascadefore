# Submission pack

Everything a reader needs, in the order they will read it.

---

## Name

**Decision as Code**

## Tagline

Every architecture decision becomes a testable file with a lifecycle. The tests run in CI, the outcomes land in Teamwork Graph, and the agent's memory is the record of decisions that survived contact with the codebase.

## Track

**Apps for Software Teams**

## Bonus categories

| Category | Evidence |
|---|---|
| **Best Agents** | `rovo:agent` "Decision Advisor" + `rovo:skill` `decision-experience` with a 6-step retrieval protocol |
| **Best app with Atlassian MCP** | `rovo:mcp` module; external clients call the reconstruction and case-base tools |
| **Best Teamwork Graph integration** | `ATTRIBUTION_QUERY` joins `decision/<id>` builds → repository → work items → PRs → deployments; 15 read scopes granted |
| **Best Marketplace published app** | Free listing; install-link identity separate from the licensed listing identity |

## The one-paragraph version

Architecture decisions are recorded as prose and then rot silently — the code drifts, nobody notices, and the next team repeats the argument. Decision as Code makes the decision itself an assertion: a `.decisions/*.decision` file carrying a machine-checkable test. Tests run in Bitbucket Pipelines on every push and publish a commit status per decision. A single Forge app reads those outcomes through Teamwork Graph, keeps a case base in Forge SQL, and answers "what should we know before we make this decision?" with precedent — retrieved cases with their outcomes, and patterns with Laplace-smoothed confidence. Nothing is predicted; every claim is a test result or a citation.

## What is novel (precise)

> A decision artifact whose own test observes whether it is still true, so the agent's skill library contains only decisions that survived contact with the codebase.

Prior art, named honestly:

| Component | Prior art | What is new here |
|---|---|---|
| Decisions as documents | ADR (Nygard, 2011) | not new |
| Decisions as **tests** | — | new: the decision is a runnable assertion |
| Policy as code | OPA, Sentinel | different object: policies are rules, decisions are choices with alternatives |
| Case-based reasoning | Schank & Kolodner, 1983 | not new |
| Executable case base | — | new: CBR over mechanically observed outcomes |
| Outcome attribution | — | new: `decision/<id>` → build → work item → incident without a shared store |

## Rubric mapping

| Criterion (20%) | Where it is demonstrated |
|---|---|
| **Technological Implementation** | runner + 3 executors, portable SQL ledger, persisted Cypher attribution, Laplace pattern extraction, 164 tests |
| **Design** | case base UI (growth curve, patterns, precedent), reconstruction tree with then/now and graft lanes |
| **Potential Impact** | decisions rot silently; the orphan rate is itself a finding a team can act on |
| **Innovation** | decisions as executable assertions; the case base is memory of what *held* |
| **Presentation** | 3-minute video, six beats, every claim on screen |

## Numbers to quote (verifiable in the repo)

```
164 tests, tsc clean, forge lint clean
6 seeded decisions · 4 enforced · 1 violated · 1 orphaned · 83% testable
growth curve: 3 cases → 0.80 · violation → 0.667 · recovery → 0.714
2 patterns extracted, each with its supporting decision ids
commit status key capped at 40 chars; decision/<id> is the join key
```

## Honest limitations to state first

1. **Testability ceiling.** Roughly 40–60% of architecture decisions admit a distinguishing test. The rest are `manual` and therefore orphaned — reported, not hidden.
2. **Retrieval is structural, not semantic.** Cases are matched on shared domain, constraint and terms. It will not surface a conceptually similar case that shares no vocabulary. That trade buys explainability.
3. **Teamwork Graph is read-only.** The write path is Confluence content, not graph mutation.
4. **No shell in Forge.** Shell tests run in the pipeline, where shell exists.
5. **The 2026 work-item view hides app panels** behind a manual "Apps" panel ([ECO-1643](https://jira.atlassian.com/browse/ECO-1643), declined). So the product surfaces on a dashboard gadget, a Confluence byline, and the agent — not on a panel.

## Repository map for a reviewer

```
src/decisions/      artifact, parser, runner, retrieval, patterns, service, store, schema
src/runner/         load, executors (fs/http/graph), statuses, report
src/mirror/         page renderer, storage format, idempotent sync, ingest, confluence target
src/attribution/    decision/<id> → build → work item → PR
src/seed/           demo scene plan + executor + forge client
src/graph/          persisted Cypher catalog, transport, decision synthesis, sandbox
src/domain/         time gate, scoring, intent policy, graft, projection
static/panel/       React panel: reconstruction tree, case base, outcome trail
scripts/            serve.ts (sandbox), run-decisions.ts (runner), render.ts (offline report)
docs/               PROJECT_PLAN, ARCHITECTURE, DEMO_SCRIPT, JIRA_MOUNT_DIAGNOSIS, spike
```

## Install instructions (for judges)

```bash
git clone https://github.com/TCPCore/cascadefore
cd cascadefore && npm install && npm --prefix static/panel install
npm run serve:web          # http://127.0.0.1:4173
```

No Atlassian account required to evaluate the product: the sandbox runs the identical engine, case base and ledger.

For the Forge side:

```bash
forge login
forge deploy -e development
forge install --demo-site -p Jira -e development --confirm-scopes
```

## Licence

Apache 2.0.
