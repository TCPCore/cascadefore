# Environment review — what is actually available, and what it means

**Date:** 2 Nov 2026 · **Site:** `one-atlas-xoan.atlassian.net` (provisioned demo site)
**App:** `ari:cloud:ecosystem::app/1fcb1899-1194-47c1-a794-26e4d3e59e0f` · v2.3.0 production
**Account:** `iamtrilliontt` (`712020:af287267-…`), not an org admin on any corporate site

---

## 1. Verified platform facts (from the CLI, not from memory)

| Fact | Value |
|---|---|
| Environments | `production` (deployed 14:37Z), `staging`, `development` |
| Runs on Atlassian | **eligible** — the app has no egress, no external hosts, no webtrigger |
| Forge SQL | `sql` module declared, `mysql` engine, 1 GiB/install |
| Install | Jira + Confluence, **production** environment, scopes consented |
| Scopes granted | 15 Teamwork Graph read scopes, Confluence read/write, `write:jira-work` |
| Distribution | `Not sharing` (installable by contributors via CLI only) |

## 2. What the site actually offers

From the product rail and the space picker:

- **Jira** — spaces `CLSD`, `CX`, `DESIGN`, `EO`, `ENGS`, `FAC`, `HR`, `INV`, plus a Financial Manager project. `CX-11` ("Checkout build failed") exists.
- **Confluence** — present; **no ADR pages, no decision records**.
- **Jira Service Management** — the site is JSM-flavoured: approvals, organizations, request language.
- **Rovo** — Chat, Search, Studio, and Rovo Dev are all present in the rail.
- **Bitbucket** — present as a product, but **no workspace scoped to this app**.
- **Compass, Goals, Teams, Assets, Analytics, Guard Detect** — present.
- **Demo command center** — a `one-atlassian-command-center` admin page with **Roll Days** (shift all dates up to ±364 days) and Streaming Status.

**Consequence:** the site has products but almost no *decision content*. There are no ADRs, no build records, no deployments, no component links. Anything that reconstructs from the graph has nothing to reconstruct from until we seed it.

## 3. Capability matrix — what is possible, what is proven

| Capability | Needs | Present on site? | App state | Proven at runtime? |
|---|---|---|---|---|
| `jira:issueContext` panel | Jira issue view | yes | deployed | **no** |
| `jira:issuePanel` | Jira issue view | yes | deployed | **no** |
| `rovo:agent` | Rovo entitlement | yes (Studio in rail) | manifest, prompt resource | **no** |
| `rovo:skill` | Rovo + skill Preview | yes | `SKILL.md` + rubric, lint-clean | **no** |
| `rovo:mcp` | admin enables external exposure | yes | 1 module, 1 tool | **no** |
| Teamwork Graph read | org-admin consent + Preview availability | **unverified** | 3 persisted-Cypher specs written from docs | **no** |
| Forge SQL | `sql` module | yes | schema + repository + migrations | **no** |
| Async consumer | queue | yes | deployed, bypassed by `CASCADE_INLINE` | **no** |
| Bitbucket build trigger | Bitbucket workspace scope | product only | **not built** — workspace scopes cannot coexist with Jira site scopes in one app | **no** |
| Confluence dossier write | `write:confluence-content` | yes | scope granted, writer **not built** | **no** |

**The single most important line in this table:** nothing on the Jira side has ever executed. `forge logs` shows **zero invocations**, which means the modules have never mounted. Every Jira capability is *installed and unproven*, and the environment review cannot change that — only a mount can.

## 4. What is actually proven

The engine, the scoring, the projections and the UI are proven **outside** Jira:

- 73 unit tests, `tsc` clean
- Full pipeline end to end against the seeded graph
- Two-intent divergence asserted in tests and visible in the standalone host
- The standalone host serves the same React panel over plain HTTP
- All six event kinds reconstruct a graph (`build-failure`, `incident`, `deployment`, `task`, `milestone`, `service-change`)

So the risk is not "does the product work". The risk is "does Forge mount the module on this Jira". Those are separable, and the standalone host keeps them separated.

## 5. Event model — "graph around an event, walk forward or backward"

`src/domain/events.ts` defines six anchors. Each selects which object types the traversal roots on and where the terminal sits; **everything downstream is identical**, which is why one engine covers all of them.

| Event kind | Anchors | Terminal |
|---|---|---|
| Build failure | ExternalBuild, ExternalCommit, JiraWorkItem | external-build |
| Incident | JiraWorkItem, ExternalDeployment, CompassComponent | work item |
| Deployment | ExternalDeployment, ExternalBuild, CompassComponent | external-deployment |
| Task / work item | JiraWorkItem, Status, Comment | work item |
| Milestone / release | JiraVersion, JiraSprint, JiraWorkItem | work item |
| Service change | CompassComponent, ComponentLink, JiraWorkItem | component |

Walking is a first-class axis, not a view toggle:

- **Backward** — from the event to the decisions that made it possible. Diagnosis.
- **Forward** — from the earliest decision to the event. Narrative.
- **At any node** — selecting an alternative shows its projection: precedent (builds that passed on it), invalidation (which downstream decisions it contradicts), and cost (dependent objects to move).

## 6. Where the Jira mount problem actually stands

Three hypotheses remain, and they are cheap to separate:

1. **Module never registered.** Would be visible in *Manage apps* as a version mismatch or a missing app entry.
2. **Module registered, panel not mounted** because the issue view is the JSM "work item" layout rather than the standard Jira issue view.
3. **App installed site-wide but the module requires per-project enablement.**

The decisive check is one screen: **⚙️ → Apps → Manage apps → Cascade**. Until that is answered, further deploys are guesses. The standalone host exists so the product does not depend on the answer.

## 7. What "apply everything possible" means, in order

1. **Seed the graph** — the app creates its own ADRs, work items, comments and build records via `api.asApp()`. Without this, every capability above reads an empty graph. Highest value per hour.
2. **Rovo Agent + Skill** — once the action runs, the agent gives a conversational surface ("why did CX-11 break?") that needs no UI mount at all. This is the escape hatch if the panel never mounts.
3. **MCP** — expose the same action as one tool; admin enables external exposure; demo from Claude Desktop.
4. **Dossier write to Confluence** — the only sanctioned "write into the graph" path, and a bonus-prize requirement.
5. **Bitbucket trigger** — a second app identity with a workspace scope. Defer; it does not block any demo.
6. **Teamwork Graph live** — replace the demo source once scopes are confirmed; the code path already exists behind `createGraphSource`.

## 8. Recommended next three moves

1. Seed the graph through the app (Jira + Confluence content), so the demo has real artefacts.
2. Build the Rovo agent path end to end — it is the only surface that works even if the panel never mounts.
3. Answer the *Manage apps* question once, then either fix the mount or formally fall back to the standalone host as the demo surface.
