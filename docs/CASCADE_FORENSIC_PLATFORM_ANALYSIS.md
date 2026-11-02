# Cascade — Forensic Platform Analysis & Build Plan

**Prepared:** 1 November 2026
**Deadline:** 22 December 2026, 12:00 PM PT — **51 days**
**Subject:** Codegeist 2026 rules + Atlassian Cloud developer platform, analysed against the *Cascade* concept (counterfactual decision-path reconstruction for software teams).

**Sources verified this session**
- Rules (Devpost page is Cloudflare-gated; read via mirror): <https://ainave.com/events/hackathons/codegeist-2026-build-with-context-ship-with-confidence>
- Official announcement: <https://community.developer.atlassian.com/t/heads-up-developers-codegeist-2026-is-officially-open/103506>
- Platform docs (`.md` endpoints render reliably): Forge manifest modules, Teamwork Graph, limits, events, billing.

---

## 0. Executive summary — the eight findings that change the plan

| # | Finding | Consequence |
|---|---|---|
| 1 | **The Teamwork Graph API is read-only.** "All Teamwork Graph API scopes are read-only — there is no write access to the graph through this API." | The "write into the graph" half of the Teamwork Graph bonus **cannot** be done via the API. Plan a Confluence dossier page (ingested after the fact) or a `graph:connector`. |
| 2 | **There is no `Decision` object type.** The graph has goals, projects, teams, work items, comments, pages, builds, deployments — no decision node. | Cascade must **synthesise** decision nodes from evidence. That is a real design constraint *and* the moat: nobody can query for decisions because decisions aren't modelled. |
| 3 | **The fifth judging criterion is Presentation, not Business Viability.** | A 20% block rides on a <5-minute video. Budget real days for it; script it in week 3, not week 7. |
| 4 | **Bonus prizes are 30% of the pool and 24 of 33 winning slots.** | Optimising for three bonus categories has better expected value than optimising for the podium. |
| 5 | **`rovo:mcp` allows exactly one module per app, max 50 tools.** | Design the MCP surface as a small, curated set of 3–5 tools, not a mirror of every action. |
| 6 | **A missing TWG scope returns an empty result, not an error.** | Empty ≠ no data. The app must *prove* scope coverage or the demo silently dies on stage. |
| 7 | **Resolver/runtime limit is 25s; async events allow up to 900s.** | The traversal + scoring pipeline must be asynchronous, persisted to Forge SQL, and polled. This is an architecture decision, not an optimisation. |
| 8 | **Forge apps are Marketplace-monetisable only as Free or Paid via Atlassian (PvA).** 100% revenue share on the first $1M lifetime. | Revenue story is clean and citable, but no metered/microtransaction billing exists. |

---

## 1. Forensic analysis: Codegeist 2026 rules

### 1.1 Verified facts

| Item | Value |
|---|---|
| Window | 27 Oct – 22 Dec 2026 (57 days total; **51 remain** as of 1 Nov) |
| Deadline | 22 Dec 2026, 12:00 PM PT |
| Total pool | $120,000 USD |
| 1st place | $15,000 × 3 winners + 2 Team '27 (AMER) tickets + blog + swag |
| 2nd place | $8,000 × 3 |
| 3rd place | $5,000 × 3 |
| Bonus prizes | $1,500 each, **6 winners each**, four categories = $36,000 |
| Participation | Swag pack, 300 winners, first-come, max 4 per submission |
| Tracks | Apps for Software Teams · Apps for Business Teams · Apps for Specialized Industries |
| Technical requirement | Built on **Forge** + integrates **at least one** Atlassian product/capability (Jira, Confluence, JSM, Bitbucket, Teamwork Graph, Rovo) |

**Bonus categories, verbatim in substance:**

- **Best Agents** — apps using `rovo:agent` or `rovo:agentConnector`, *or* reusable `rovo:skill` / `rovo:action` modules other agents can invoke.
- **Best app with Atlassian MCP** — Forge apps that expose an MCP server.
- **Best apps with Teamwork Graph integration** — projects that **write data into the graph *or* consume data from the Teamwork Graph API**.
- **Best Marketplace published app** — published to Marketplace **or submitted for listing**; a listing link or Marketplace review ticket suffices. Approval is *not* required.

### 1.2 What the scoring model actually rewards

Five criteria, **20% each**:

1. **Technological Implementation** — thorough, skilful use of Forge + an Atlassian capability; working and **non-trivial**.
2. **Design** — a complete, coherent product experience, not a technical proof of concept.
3. **Potential Impact** — credible case for a real problem and a real audience.
4. **Innovation / Idea** — creative and novel.
5. **Presentation** — video demonstrates the project end-to-end and explains problem, audience, value.

**Read of the rubric.** "Non-trivial" + "not a proof of concept" are the two clauses that kill most hackathon entries. A persisted-Cypher traversal feeding a deterministic scorer feeding a three-lane UI is non-trivial by construction; a chat wrapper is not. "Design" at 20% means the cascade tree must be legible in a video, at 1080p, in under five minutes — that is a hard visual-design constraint on node count and label length.

### 1.3 Submission mechanics (build for these, not around them)

- **Install link + clear instructions** so judges can test the app. This means the app must deploy into a *fresh* site with a *single* admin consent flow. Org-admin consent for TWG scopes is a friction point — document it in one screenshot.
- **Demo video < 5 minutes**, YouTube, public.
- **Category + bonus prize selections** with supporting materials.
- **Explanation of how the technical requirement is met.**

### 1.4 Strategic read: the bonus-prize math

Podium: 9 slots. Bonus: 24 slots. A project that is *good* across three bonus categories has a materially better chance of returning something than one that is *excellent* but category-ambiguous. Cascade can credibly enter **three** (Agents, MCP, Teamwork Graph) and **one** cheap fourth (Marketplace listing ticket, filed early, no approval needed).

That reframes scope: build one deep thing (TWG traversal + scoring), then *package* it three ways (`rovo:skill`, `rovo:mcp`, dossier write-back). Packaging is days, not weeks — if the manifest is designed for it from day one.

---

## 2. Forensic analysis: Atlassian developer platform

### 2.1 Forge execution model and the limits that shape architecture

Forge is serverless, manifest-declared, OAuth-scoped. Functions are the unit of compute.

| Limit | Value | Design consequence |
|---|---|---|
| Runtime (resolvers, UI-invoked) | **25 s** | Cannot run a multi-hop traversal + LLM render synchronously |
| Runtime (web trigger, `action`, `rovo:agentConnector`) | **55 s** | The MCP/agent path has more headroom than the UI path |
| Runtime (async events / scheduled) | **900 s**, default 55 s, extend via `timeoutSeconds` | The correct home for reconstruction jobs |
| Memory | 512 MB default, **1024 MB** max | Fine for scoring; not for holding large result sets |
| Payload | 5 MB invocation / 500 KB frontend request | Do not ship the whole tree through `invoke` |
| Egress | 100 req/runtime-minute | External HTTP is cheap but not free; see RoA below |
| Invocation rate | 1,200/min/user; 7,000/min/install | Fine for demo scale |

**Architectural conclusion.** The reconstruction is a *job*: `action` (55 s) or async event (900 s) runs the persisted Cypher traversal, computes the deterministic scores, writes a `cascade_run` row to Forge SQL, and returns a run ID. The Custom UI panel subscribes/polls and renders the persisted tree. Never block a 25 s resolver on graph traversal plus model inference.

### 2.2 Teamwork Graph API

**Status:** Preview. Fully supported, shorter deprecation windows, breaking changes with a **1-month** notice.

**Shape:** unified GraphQL endpoint `https://<site>.atlassian.net/gateway/api/graphql/twg`, with two query modes:

| Mode | Registration | Use |
|---|---|---|
| **Curated queries** | none | Typed fields for common traversals (`atlassianUserAssignedJiraWorkItems`, `confluencePageContributors`, `jiraWorkItemComments`) |
| **Persisted Cypher** | register once → `queryKey` | Custom multi-hop traversals. **This is Cascade's engine.** |

**Persisted Cypher operational facts (these are load-bearing):**

- Register via TWG Labs (<https://teamwork-graph.atlassian.com/query-builder>) or `POST /gateway/api/twg/cypher-queries` with `appId`, `name`, `cypher`, optional `paramsSchema`.
- Returns `{ queryKey, version, contentHash, status }`. **Queries are owned by an app**; only that app can execute the key.
- **Propagation ~1 minute.** Executing early yields `QUERY_NOT_FOUND` — retry, don't fail.
- **Resubmission is idempotent** on identical Cypher text — safe to run from a setup script on every deploy. Good: bake it into `forge deploy` post-hook.
- **Immutable.** To change a traversal, register new text → new key → switch the app over.
- **`first` max 25**, and permission filtering happens *after* paging — so a page may return fewer rows than requested and still have `hasNextPage`. Drive loops off `hasNextPage`, never off row count.
- Execution errors arrive as GraphQL errors with HTTP 200: `QUERY_NOT_FOUND`, `NOT_OWNER`, `INSTALLATION_NOT_FOUND`, `FEATURE_UNAVAILABLE`.
- Rows are **permission-filtered for the authenticated user**. Two users, same key, same params → different results. This is a demo hazard *and* a selling point.

**Scopes:**

- Pattern `read:graph:<object>:<product>` — e.g. `read:graph:issue:jira`, `read:graph:page:confluence`, `read:graph:issue-comment:jira`, `read:graph:build:external`, `read:graph:deployment:external`, `read:graph:user:atlassian`, `read:graph:team:atlassian`, `read:graph:goal:atlassian`.
- **Scope every object type in the traversal, including intermediate hops.** A→B→C with no scope on B empties the whole result.
- **Missing scope = silent empty result.** Fails closed by design.
- Scope changes take **~1 minute** to propagate.
- **Forge scope cap is 50** — relevant when translating old product-wide EAP scopes.
- **Org-admin consent required** to install TWG scopes (org-wide data access).
- TWG API is **Jira/Confluence installs only** (including multi-app-compatible apps with one of those).
- **Read-only.** No write path.

**Calling it:**
- Backend: `@forge/api` → `api.asUser().requestTeamworkGraph(query, variables)`.
- Frontend: `@forge/bridge` → `requestTeamworkGraph(query, variables)` — always as the current user.
- Apps **cannot** call the graph as the app identity.

**The object model — and what's missing.** Available types: Atlassian (`Goal`, `GoalUpdate`, `HomeComment`, `HomeTag`, `Project`, `ProjectUpdate`, `Team`, `TeamType`, `User`, `TeamCustomFieldValue`), Compass (`Component`, `ComponentLink`, `Scorecard`), Confluence (`Page`, `Blogpost`, `Comment`, `Database`, `Embed`, `Space`, `Whiteboard`), External (`Build`, `Deployment`, `Commit`, `Branch`, `PullRequest`, `Repository`, `WorkItem`, `Document`, `Vulnerability`, `Service`, `FeatureFlag`, …), Focus (`FocusArea`, `ChangeProposal`), Jira (`WorkItem`, `WorkItemComment`, `WorkItemStatus`, `WorkItemPriority`, `WorkItemRemoteLink`, `WorkItemWorklog`, `Space`, `Board`, `Sprint`, `Version`), Loom, Opsgenie.

> **There is no `Decision` object.** Cascade's central noun does not exist in the schema.

**What *is* usable as decision evidence:**
- `ConfluencePage` with ADR/"Options considered"/"Decision record" shape, plus `ConfluenceComment` threads (including unanswered alternative proposals).
- `JiraWorkItem` + `JiraWorkItemComment` + `JiraWorkItemStatus` transitions + `JiraSprint`/`JiraVersion` boundaries.
- `ExternalBuild` / `ExternalDeployment` / `ExternalCommit` / `ExternalPullRequest` for the failure terminal and for implementation proof of alternative paths.
- `AtlassianGoal` / `AtlassianProject` / `AtlassianTeam` for intent and ownership/`surprise_map`.
- `CompassComponent` for service ownership and scorecard state.

That list is the actual `DecisionCandidate` extractor spec.

**Graph write path (for the bonus).** Two legitimate routes:
1. **Content write → graph ingestion.** Create a Confluence child page containing the dossier via the Confluence REST API. The graph ingests it. Honest, cheap, demoable — the page is the artifact a human reads *and* the record the graph will index.
2. **`graph:connector` module + Connector SDK** (`object`, `user`, `group`, `relationship`, `task` operations). Real write access, Jira-install-only, requires capability declarations, documentation, sync and deletion semantics. **Too heavy for 51 days** unless the demo *is* the connector.

Recommendation: route 1 for the hackathon, route 2 named in the writeup as the production path.

### 2.3 Rovo modules — the three packaging surfaces

**`rovo:agent`**
- Fields: `key`, `name` (**≤30 chars**), `description`, `icon`, `prompt` (inline or `resource:` path — needs Forge CLI ≥ 10.6.0), `conversationStarters`, `actions`, `skills`, `followUpPrompt`.
- **Data access is app-scoped.** A Jira-installed agent does *not* automatically see Confluence at the same site. Cross-product needs **multiple app compatibility** (Preview).
- Interaction points: chat side panel, `/ai` toolbar in Jira & Confluence editors, Automation rules (async), and programmatic via the bridge `rovo` API.

**`rovo:skill`** (Preview)
- Packages a `SKILL.md` (Agent Skills spec, <https://agentskills.io/specification>) + optional `references/` + optional action dependencies from the same app.
- Frontmatter: `name` (must equal directory name, lowercase/hyphens, 1–64), `description` (**1–1,024 chars**, use ≥50), optional `compatibility`, `metadata`, `license`, `allowed-tools`.
- Body **≤500 lines**; directory **≤100 MB**; **no executable scripts**; **no skill-to-skill dependencies**.
- Attach to an agent by listing the skill key in `rovo:agent.skills`. Agent selects by description; **explicit invocation by name is not supported** during Preview.
- **Also qualifies for Best Agents on its own** — "reusable `rovo:skill` … modules that other agents can invoke."

**`rovo:mcp`** (Preview)
- **Exactly one module per app.** `key`, `name` (**≤30 chars**), `tools[]` = action keys, **max 50**.
- External clients connect at `https://mcp.atlassian.com/forge/<appId>` (the UUID from `ari:cloud:ecosystem::app/<uuid>`).
- **External exposure is disabled by default** and must be enabled per-site by an admin in **Apps → Sites → *site* → Connected apps**. OAuth 2.1 consent screen on connect.
- Same app-scoped data caveat as agents.

**Packaging implication for Cascade:** one `action` (the reconstruction job), exposed via all three surfaces — as a skill step, as agent actions, and as the single MCP tool. Keep the MCP surface to ~5 tools so the consent screen and the demo stay readable.

### 2.4 Storage

| Store | Limit | Verdict for Cascade |
|---|---|---|
| **KVS** | 240 KiB/value, depth 31, keys ≤500 chars, 4,000 reads/writes per min | Only for small pointers/config. Not trees. |
| **Custom Entity Store** | 240 KiB/object, depth 31, ≤20 entities, ≤7 indexes, ≤50 attributes, 100 conditions/query | Viable for a *node-per-entity* model, but 240 KiB caps evidence payloads |
| **Forge SQL** | **1 GiB prod** / 256 MiB staging, ≤200 tables, 6 MiB row, **5 s SELECT timeout**, 62.5 s query-time/min, 150 DML RPS, no FKs | **Correct home** for runs, nodes, edges, evidence, scores. Watch the 5 s SELECT. |
| Object Store | throughput/object-size limits | For large blobs only — not needed |

Adding Forge SQL to an existing app forces a **major version upgrade** (admin re-consent). Add the `sql` module on day one, before you have installs.

### 2.5 Billing and Marketplace

- Forge apps on Marketplace may be listed **Free** or **Paid via Atlassian (PvA)** only. **No Paid-via-Vendor for Forge.** Confirmed by Atlassian Marketplace staff, Oct 2026.
- **100% revenue share on the first $1M lifetime Forge revenue (0% Atlassian commission).** Standard rate applies after.
- Marketplace **price guidance is advisory, not enforced** — you may price under guidance.
- Listing **approval is not required** for the bonus prize; a review ticket or listing link suffices.

### 2.6 Events — the "build broke" trigger

| Event | Scope |
|---|---|
| `avi:bitbucket:created:build-status` | `read:repository:bitbucket` |
| `avi:bitbucket:updated:build-status` | `read:repository:bitbucket` |
| `avi:bitbucket:completed:deployment` | `read:pipeline:bitbucket` |
| `avi:bitbucket:created:pullrequest` | `read:pullrequest:bitbucket` |

Build-status payload carries `buildStatus.state` (`FAILED` / `SUCCESSFUL` / …), `buildStatus.commit.hash`, `refName`, `url`, `createdOn`, `updatedOn`, plus `repository.uuid`, `project.uuid`, `workspace.uuid`.

**Caveats:** delivery can be **significantly delayed** (use event timestamps); emit from the *actor*, so filter `selfGenerated`; and **Forge does not support Bitbucket webhook REST APIs** — use product events only.

### 2.7 Documentation inconsistencies to plan around (real, observed, and expensive if ignored)

1. **Scope model drift.** The bridge `requestTeamworkGraph` page still shows EAP product-wide scopes (`read:graph:jira`) and an "app not allowlisted" troubleshooting path; the scopes page says per-object scopes are *definitive* and product-wide scopes are **retiring**. **Plan for per-object scopes; keep a `read:graph:jira` fallback behind a flag.**
2. **`requestTeamworkGraph` is still labelled EAP** while the API itself is Preview and the docs state Preview is "available to all users."
3. **`rovo:skill` docs are internally inconsistent** — one banner says Preview/fully supported, the limitations section still says "during Preview." Treat Preview as: works, will change, pin your CLI.
4. **Agent data-access caveat vs. TWG access.** The agent can't *see* Confluence by default, but the *action* it calls can query TWG (which spans products) subject to scopes. Keep all cross-product reads inside actions, never in the prompt's implicit context.

---

## 3. Corrections to the working concept

Direct, because these were assumptions carried into the design and they are wrong or unverified.

| Assumption held earlier | Reality | Design consequence |
|---|---|---|
| "Write the dossier back into the graph" via the TWG API | API is **read-only** | Write a Confluence child page (ingested) and, in production, a `graph:connector` |
| Judging includes "Business Viability" | Fifth criterion is **Presentation** | Reallocate effort: video is 20%, not a footnote |
| The graph has decision objects | **No `Decision` type** | Build `DecisionCandidate` synthesis; that synthesis *is* the IP |
| Use an external LLM for scoring/narration | Breaks **Runs on Atlassian**; TWG data is intended not to egress | Use **Forge LLMs** (`@forge/llm`); keep scoring deterministic anyway |
| Persisted Cypher returns a full tree in one call | **25 rows/page**, permission-filtered post-paging | Loop `hasNextPage`; cache rows in SQL mid-traversal |
| MCP tools are reachable by any client immediately | **Admin must enable exposure per site**; OAuth 2.1 | Demo script must show the toggle; install docs must call it out |
| Cross-product data "just works" | App-scoped; needs multiple-app compatibility (Preview) | Install into **both** Jira and Confluence in dev; scope MVP to Jira-only traversal if unstable |
| 0% rev share is permanent | Only **first $1M lifetime** | Say it correctly in the video; judges check claims |
| Scope breadth is free | **50-scope cap**; per-object scopes multiply | Count scopes in week 1 against the traversal |

---

## 4. Cascade as it must actually be built

### 4.1 The thesis, restated for this platform

> A build breaks. Cascade walks the Teamwork Graph backwards to the decision that seeded it, reconstructs the branches that were evidenced *at that moment*, scores each against **what was knowable then** versus **what proved viable since**, and recommends the cheapest evidenced path back to the team's stated intent — every claim carrying an ARI.

The sentence that survives the platform constraints: **"The failure wasn't a bad decision; it was an unconnected graph."**

### 4.2 Decision-node synthesis (the missing object)

Because no `Decision` type exists, define a **`DecisionCandidate`** and extract it:

| Candidate class | Signal | Confidence |
|---|---|---|
| **Documented decision** | `ConfluencePage` whose title/body matches ADR patterns ("ADR", "Decision record", "Options considered", "RFC", "Design doc") and is linked to the failing work item | High |
| **Thread decision** | `JiraWorkItemComment` / `ConfluenceComment` thread with ≥3 replies and a resolution marker ("we'll go with", "decided", "closing as") | Medium |
| **Transition decision** | `JiraWorkItemStatus` change to Done/Cancelled on a linked item, within the causal window | Medium |
| **Implicit decision** | Absence of a documented decision at a point where sibling components *did* document one | **Highest value — the "silent rejected path"** |

Every candidate gets `{ ari, kind, confidence, decided_at, actor_aris[], evidence_aris[] }`. **Confidence is a rule output, never an LLM opinion.** If a candidate has no ARI, it does not render.

### 4.3 Evidence model and the time gate

```
EvidenceObject := {
  ari, type, created_at, last_updated,
  source_authority,          // ADR page 1.0 > page comment 0.7 > issue comment 0.6 > status event 0.5
  independence_key           // distinct author OR distinct component
}
```

**Time gate (definition, operationalised):**
`knowable(E, N) ⇔ E.created_at ≤ N.decided_at AND E reachable from N's context (same project / component / explicit link)`.

This is a `WHERE` clause in Cypher plus a filter in the scorer. It is the entire hindsight-bias defence and it must be visible in the UI per node.

### 4.4 Scoring — deterministic, countable, exposed

Per branch `b` at node `N`:

```
W_k(b) = Σ over evidence e passing the gate at N:
           authority(e) × independence_weight(e) × recency_weight(e, N.decided_at)
W_v(b) = Σ over evidence e (all time):
           implementation_proof(e) × corroboration(e) × outcome_alignment(e)
Gap(b)  = W_v(b) − W_k(b)
Conf(b) = min(W_k(b), W_v(b))
```

Forward recommendation, per path `p` (spine prefix + one branch):

```
Score(p) = (F(p) × A(p)) − (M(p) + X(p)),  R(p) as confidence multiplier
F = intent fit (hard-constraint violation ⇒ veto)
A = applicability today (dependencies alive? API deprecated? owning team active?)
M = migration cost (count of dependent graph objects to unwind)
X = residual risk (unresolved nodes on the retained prefix)
R = freshness (evidence superseded since decision date)
```

**Non-negotiable rule:** every sub-score is derived from a counted graph fact and is inspectable in a tooltip. The first LLM-judged number destroys the concept's credibility, and a judge *will* ask.

### 4.5 Recommendation as a graft

Output is never "revert." It is three lanes:

- **Keep** — spine prefix already shipped and still valid.
- **Graft** — the highest-scoring evidenced branch at the divergence node.
- **Unwind** — only the spine segments the branch contradicts, each with its dependent-object count.

Plus: *"No evidenced path achieves your stated intent"* as a first-class result, naming the failing criterion and the gap that requires an unevidenced segment. Admitting where evidence ends is what makes the rest trustworthy.

### 4.6 Architecture

```
┌──────────────────────────── Jira issue (new issue view) ────────────────────────────┐
│  jira:issuePanel (Custom UI, React)                                                  │
│   • Cascade tree  • Then/Now columns  • Keep/Graft/Unwind  • Evidence tooltips        │
└───────────────▲──────────────────────────────────────────────┬──────────────────────┘
                │ invoke(runId) / poll                          │ requestTeamworkGraph (as user)
                │                                               │
┌───────────────┴───────────────┐                    ┌──────────▼───────────┐
│ Forge function (resolver ≤25s)│                    │ Teamwork Graph API    │
│  • create run, enqueue        │                    │ (Preview, read-only)  │
└───────────────┬───────────────┘                    └──────────▲───────────┘
                │ async event (≤900s)                           │ customQuery(queryKey)
┌───────────────▼───────────────────────────────────────────────┴───────────┐
│ Reconstruction job                                                         │
│  1. resolve failure terminal (build status event → commit → work item)     │
│  2. spine traversal   (persisted Cypher #1)                                │
│  3. candidate extraction (persisted Cypher #2, branches)                   │
│  4. time gate + W_k / W_v / Gap  (pure TS, unit-tested)                    │
│  5. intent parse (Forge LLM, structured output only)                       │
│  6. rank + graft assembly                                                  │
│  7. persist run to Forge SQL                                               │
│  8. write Confluence dossier child page (dossier = graph write-back path)   │
└────────────────────────────────────────────────────────────────────────────┘
        │                                    │
┌───────▼────────┐                  ┌────────▼─────────┐
│ Forge SQL      │                  │ rovo:skill       │
│ runs/nodes/    │                  │ rovo:agent       │
│ edges/evidence │                  │ rovo:mcp (1 tool)│
└────────────────┘                  └──────────────────┘
```

**Two traversals, not one.** Separating spine from branch extraction keeps each Cypher query inside the 5 s statement budget and makes them independently testable.

### 4.7 Manifest sketch (verify with `forge lint` — do not trust this verbatim)

```yaml
app:
  id: ari:cloud:ecosystem::app/<uuid>
  runtime:
    name: nodejs22.x
    memoryMB: 1024

modules:
  jira:issuePanel:
    - key: cascade-panel
      resource: main
      resolver: { function: resolver }
      title: Cascade
      icon: resource:main;icon.svg

  function:
    - key: resolver
      handler: src/resolver.handler
    - key: reconstruct
      handler: src/jobs/reconstruct.handler
      timeoutSeconds: 300
    - key: run-cascade
      handler: src/actions/runCascade.handler

  action:
    - key: reconstruct-decision
      name: Reconstruct decision cascade
      function: run-cascade
      actionVerb: GET
      description: Reconstruct the evidenced decision paths behind a failed build
      inputs:
        workItemKey: { title: Work item key, type: string, required: true }
        intent:      { title: Intent, type: string, required: false }

  rovo:agent:
    - key: cascade-agent
      name: Cascade            # ≤30 chars
      description: Reconstructs the decision paths that led to a failure
      prompt: resource:agent;prompt.txt
      skills: [decision-autopsy]
      actions: [reconstruct-decision]

  rovo:skill:
    - key: decision-autopsy
      source: { dir: skills/decision-autopsy }
      dependencies: { tools: [reconstruct-decision] }

  rovo:mcp:
    - key: cascade-mcp
      name: Cascade            # ≤30 chars, one module only
      tools: [reconstruct-decision]

  sql:
    - key: cascade-db

resources:
  - key: main
    path: static/panel/build
  - key: agent
    path: resource/agent

permissions:
  scopes:
    - read:graph:issue:jira
    - read:graph:issue-comment:jira
    - read:graph:issue-status:jira
    - read:graph:page:confluence
    - read:graph:comment:confluence
    - read:graph:build:external
    - read:graph:deployment:external
    - read:graph:commit:external
    - read:graph:user:atlassian
    - read:graph:team:atlassian
    - read:graph:goal:atlassian
    - read:repository:bitbucket
    - write:confluence-content        # dossier page
    - read:confluence-content.all
```

---

## 5. Development path — 51 days

Each phase has an **exit criterion**. If a phase misses its exit criterion, cut scope (§9), do not extend the phase.

### Phase 0 — Foundations · Nov 1–3 (3 days)
- Node 22 LTS, `npm i -g @forge/cli`, verify `forge --version`.
- Free Atlassian Cloud dev site with **Jira + Confluence + Bitbucket**.
- `forge create` → Custom UI app; `forge deploy`; `forge install` into Jira; confirm a hello-world `jira:issuePanel` renders in the **new** issue view.
- Add `sql` module **now** (major-version-upgrade cost is zero before installs).
- **File the Marketplace listing ticket today.** It is free, requires no approval, and buys the fourth bonus entry.
- Repo: monorepo, `main` protected, CI running `forge lint` + `tsc --noEmit` + `vitest`.

**Exit:** hello-world panel visible on a real issue; listing ticket ID recorded.

### Phase 1 — Teamwork Graph spike · Nov 4–10 (7 days) ⚠️ highest risk
- `echo` query from backend (`api.asUser().requestTeamworkGraph`) and frontend (`requestTeamworkGraph`).
- Build a **scope matrix**: every object type in the intended traversal → scope → granted? This table is the project's risk register for week 1.
- Author **3 persisted Cypher queries**:
  1. `spine` — work item → linked pages → page comments → authors → sibling work items in same component.
  2. `branches` — sibling components' documented decisions + unanswered comment threads.
  3. `outcomes` — later reversal tickets / successful builds for the same component (implementation proof).
- Register via TWG Labs; capture `queryKey`s; write the idempotent registration script into the deploy pipeline (safe by design).
- Handle the 1-minute propagation window (`QUERY_NOT_FOUND` retry).
- Build a **seeded demo graph** (a real Jira project + Confluence space, not mocks): failing build → epic → ADR with "Options considered" → sibling component that chose differently and whose build passed → unanswered comment proposing a third path → reversal ticket.
- **Decide the scope fallback:** per-object scopes (target) vs `read:graph:jira` (fallback behind a flag).

**Exit:** all three queries return the expected nodes on the seeded site, from inside a Forge function, with `hasNextPage` pagination proven. If TWG access is blocked by allowlisting, trigger the fallback decision *now*, not in week 5.

### Phase 2 — Extraction + storage · Nov 11–17 (7 days)
- `DecisionCandidate` extractor over query results; confidence rules as pure functions.
- Forge SQL schema:
  `runs(id, work_item_ari, intent_json, status, created_at)` ·
  `nodes(run_id, node_id, kind, ari, decided_at, confidence)` ·
  `edges(run_id, from_id, to_id, edge_kind, evidence_ari)` ·
  `evidence(run_id, ari, type, created_at, authority, independence_key)` ·
  `scores(run_id, branch_id, w_k, w_v, gap, conf)`.
- Async job skeleton: resolver creates run → async event → job writes rows → panel polls.
- Unit tests for the time gate and pagination loop (they will regress otherwise).

**Exit:** a run persists a 15–40 node tree to SQL and the panel renders a JSON dump of it.

### Phase 3 — Scoring + intent + graft · Nov 18–24 (7 days)
- Implement `W_k`, `W_v`, `Gap`, `Conf`, and forward `Score(p)` exactly as §4.4. Every function pure, every function tested with fixtures.
- Intent capture: panel form → `{goal, success_criteria, hard_constraints, soft_preferences, non_goals, horizon}`; fall back to epic goal field, flagged `inferred`.
- **Forge LLM used only for** (a) intent text → structured object, (b) dossier prose from *already-computed* numbers. Never for path selection.
- Graft assembly + "no evidenced path" branch.
- **Two-intent fixture test:** same tree, `horizon=weeks` vs `horizon=years`, assert different top recommendation with both scoring above threshold.

**Exit:** CLI harness prints a ranked tree with per-branch arithmetic for the seeded scenario; two-intent divergence proven in tests.

### Phase 4 — The interface · Nov 25 – Dec 2 (8 days)
- Custom UI (React + Vite), Atlaskit components, no UI Kit — the tree needs bespoke layout.
- Three views: **Cascade tree** (collapse depth by default to ≤4 visible levels), **Then/Now** two-column gap view, **Keep/Graft/Unwind** lanes.
- Every node: ARI chip, confidence badge, hover card with the exact arithmetic.
- Unexpanded leaves rendered explicitly as *"unexpanded — no downstream evidence"* (this is a credibility feature, not a failure state).
- Performance: virtualise; never ship the full tree through `invoke` (500 KB frontend request cap).
- Accessibility + 1080p legibility pass (labels ≤ 40 chars, no 10px type).

**Exit:** a stranger can read the panel for 20 seconds and state what broke, which path was missed, and what to do.

### Phase 5 — Packaging + triggers · Dec 3–9 (7 days)
- `rovo:skill` with `SKILL.md` (≤500 lines, ≥50-char description, `allowed-tools` matching `dependencies.tools`), plus `references/` for the scoring rubric.
- `rovo:agent` wired to the skill + action; conversation starters that mirror the demo.
- `rovo:mcp` with **one** tool; test external client connection at `https://mcp.atlassian.com/forge/<appId>` after an admin enables exposure.
- Bitbucket `build-status` subscription → auto-surface the panel with the failure pre-loaded; filter `selfGenerated`; handle delayed events via timestamps.
- Confluence dossier write-back (child page with every claim ARI-linked) — this is the "write into the graph" story.
- Install/consent runbook with screenshots, including the **org-admin** step for TWG scopes.

**Exit:** all three Rovo surfaces invoke the same action; build failure produces a pre-loaded panel; dossier page appears in Confluence.

### Phase 6 — Demo + submission assets · Dec 10–16 (7 days)
- Script the <5-minute video (§8). Storyboard first, record second.
- Record at 1080p, cursor visible, no dead air, captions.
- Rehearse the two-intent flip as the closing beat.
- Write the submission explanation mapping each rubric line to a timestamp in the video.
- Fresh-site install test: a colleague installs from scratch using only the runbook.

**Exit:** video uploaded public; runbook validated by someone who has never seen the repo.

### Phase 7 — Buffer and submit · Dec 17–21 (5 days)
- Freeze features **Dec 17**. Only bug fixes after.
- Re-verify every factual claim in the video against this document.
- Submit **Dec 21**, one day early. Do not plan to submit on Dec 22.

---

## 6. Tooling inventory

### Build and run

| Tool | Purpose | Notes |
|---|---|---|
| **Node.js 22 LTS** | Runtime parity with `nodejs22.x` | Pin via `.nvmrc` |
| **`@forge/cli`** (`forge`) | create / deploy / install / lint / tunnel / logs | Pin version in repo; `rovo:agent` prompt-as-resource needs ≥10.6.0 |
| **`forge tunnel`** | Live logs + local handler execution | Essential for Cypher debugging |
| **`forge lint`** | Manifest + scope validation | Run in CI |
| **TypeScript** | Scoring engine safety | `strict: true` |
| **Vitest** | Unit tests for gate/scoring/pagination | Fixtures from seeded graph |
| **Vite** | Custom UI bundling | Keep bundle small (resource limits) |

### Atlassian APIs and SDKs

| Package / API | Use |
|---|---|
| **`@forge/api`** | `api.asUser().requestTeamworkGraph()`, `requestJira`, `requestConfluence`, `asApp()` |
| **`@forge/bridge`** | `invoke`, `requestTeamworkGraph`, `view.getContext`, `events.on` |
| **`@forge/llm`** | Intent parsing + prose rendering only (Runs on Atlassian) |
| **`@forge/sql`** | Run/tree/score persistence |
| **`@forge/kvs`** | Config + `queryKey` registry (small values only) |
| **Teamwork Graph GraphQL** | `https://<site>.atlassian.net/gateway/api/graphql/twg` |
| **Persisted Cypher registration** | `POST /gateway/api/twg/cypher-queries` (idempotent) |
| **TWG Labs query builder** | <https://teamwork-graph.atlassian.com/query-builder> — validate before registering |
| **Confluence REST v2** | Dossier child page creation |
| **Bitbucket product events** | `avi:bitbucket:created:build-status`, `updated:build-status` |

### Test surfaces

| Tool | Use |
|---|---|
| **Atlassian Cloud dev site** | Jira + Confluence + Bitbucket, seeded graph |
| **GraphiQL at `/gateway/api/graphql/twg`** | Interactive query iteration |
| **MCP Inspector** or Claude Desktop | Verify `rovo:mcp` external exposure |
| **Rovo Studio** | Verify custom-agent tool invocation |
| **`curl` / Postman** | Cypher registration endpoint, scope checks |

### Deliberately excluded

- External LLM providers (OpenAI/Anthropic direct) — breaks Runs on Atlassian and the TWG egress posture.
- UI Kit — cannot render the cascade tree legibly.
- `graph:connector` + Connector SDK — correct production path, wrong 51-day path.
- Any billing/metering build — PvA only; nothing to meter.

---

## 7. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Trigger |
|---|---|---|---|---|---|
| R1 | TWG API access blocked / allowlisting required | Med | **Fatal** | Week-1 spike; fallback to `read:graph:jira`; escalate on community forum | `echo` fails |
| R2 | Scope cap (50) exceeded by per-object scopes | Low | High | Count in week 1; drop Loom/Compass/External* | lint warns |
| R3 | Empty results misread as "no data" | **High** | High | Scope-coverage self-check on first run; render a diagnostic banner | any empty traversal |
| R4 | 25 s resolver timeout | High | High | Async job + SQL + poll from day one | first real traversal |
| R5 | LLM-judged score creeps in | **High** | **Fatal** | Code review rule: scoring module may not import `@forge/llm` | PR check |
| R6 | Demo graph too sparse → trivial tree | Med | High | Seed deliberately; disclose "representative mid-size org dataset" on screen | tree < 10 nodes |
| R7 | Permission filtering hides evidence for the demo user | Med | Med | Run the demo as a user with broad project access; state the caveat | missing nodes |
| R8 | `rovo:mcp` external exposure not enabled | Med | Med | Admin toggle in runbook + demo; otherwise demo in Rovo Studio | connect fails |
| R9 | Preview schema change mid-build | Low | High | Abstract query layer behind one module; pin CLI; watch changelog | deploy break |
| R10 | Marketplace review delays | Low | Low | Ticket ≠ approval; bonus needs only the ticket | — |
| R11 | Video overruns 5 minutes | Med | Med | Storyboard to 4:15; hard stop; submit the shorter cut | rehearsal |
| R12 | Scope creep into "all paths" | **High** | High | Say "evidenced paths" in every artifact; leaves labelled unexpanded | any "all" in copy |

---

## 8. Judging map and the five-minute demo

### Criterion → artefact

| Criterion (20% each) | What the judge sees |
|---|---|
| **Technological Implementation** | Persisted Cypher multi-hop traversal · deterministic scoring engine with unit tests · async job · Forge SQL · Confluence write-back · `rovo:skill` + `rovo:mcp`. Show the SQL row count and the test file on screen for 3 seconds. |
| **Design** | Three-lane graft view, Then/Now gap columns, confidence badges, arithmetic tooltips, explicit "unexpanded" leaves. No JSON visible to the user. |
| **Potential Impact** | Named audience: platform teams at 200–2,000-engineer orgs with quarterly incident retros. Named cost: one bad architecture decision ≈ weeks of rework. |
| **Innovation / Idea** | Backward causal reconstruction with time-gated evidence, not forward prediction. The line: *"Every AI tool helps you decide. This one reconstructs the decision you already made, and proves what you couldn't have known."* |
| **Presentation** | The script below, delivered cleanly, with the two-intent flip as the closing beat. |

### Script (target 4:15)

| t | Beat |
|---|---|
| 0:00–0:25 | Hook: "A build broke on Tuesday. The decision that broke it was made in March, by someone who has since left. Here's the graph." |
| 0:25–0:55 | Problem framing: decisions are modelled nowhere; failures are cascades, not moments. |
| 0:55–1:30 | Seed: failing build → panel opens pre-loaded → spine renders (4 nodes). |
| 1:30–2:20 | Branches sprout. Three evidenced alternatives. **Hover one node → show arithmetic**: `W_k 0.8 · W_v 0.9 · Gap 0.7`. |
| 2:20–2:50 | **Then/Now columns.** "At the time they could see one path. Three existed. Two were already running inside the same company." |
| 2:50–3:20 | Graft: Keep / Graft / Unwind with cost. Dossier page written to Confluence, every claim ARI-linked. |
| 3:20–3:50 | **Intent flip.** Re-run with `horizon=years` → different recommendation. "Same evidence, different goal, different answer — and neither is hindsight." |
| 3:50–4:15 | Close: Agents + MCP + Teamwork Graph badges on screen. "The failure wasn't a bad decision. It was an unconnected graph." |

---

## 9. Cut list (in order, when a phase slips)

1. `rovo:mcp` external-client demo → keep the module, demo only in Rovo Studio.
2. Bitbucket auto-trigger → manual "Run Cascade" button (the event is a nice-to-have; the traversal is not).
3. `surprise_map` (people about to be blindsided) → highest-emotion, highest-cost feature; cut before scoring degrades.
4. Confluence dossier write → keep a structured Jira comment instead (still a graph-ingested artifact).
5. `CompassComponent` traversal → Jira-only spine.
6. Second persisted query → fold branch extraction into the spine query (costs the 5 s budget; do it last).

**Never cut:** the time gate, the deterministic scorer, the Then/Now view, the two-intent demo. Those four *are* the entry.

---

## 10. Open questions to resolve in week 1

1. Is TWG API access allowlisted per app, or truly open at Preview? (`echo` test answers this in 20 minutes.)
2. Do per-object scopes install cleanly on a fresh site with org-admin consent, or does the EAP broad scope still short-circuit?
3. Does the bridge `requestTeamworkGraph` accept per-object scopes today, or only the EAP product-wide ones?
4. What is peak `W_k`/`W_v` behaviour when *zero* evidence passes the gate — does the UI degrade to "no evidenced path" gracefully?
5. Does the seeded graph survive `forge install` on a **different** site (i.e. can a judge reproduce it)? If not, ship a seed script in the repo.
6. `rovo:skill` description length vs. skill-selection reliability at Preview — does a 300-char description actually get picked?

---

## Appendix A — Verified source index

| Topic | URL |
|---|---|
| Rules (mirror) | https://ainave.com/events/hackathons/codegeist-2026-build-with-context-ship-with-confidence |
| Official announcement | https://community.developer.atlassian.com/t/heads-up-developers-codegeist-2026-is-officially-open/103506 |
| Persisted Cypher | https://developer.atlassian.com/platform/teamwork-graph/persisted-cypher-queries/ |
| Scopes (definitive) | https://developer.atlassian.com/platform/teamwork-graph/scopes/ |
| TWG limitations | https://developer.atlassian.com/platform/teamwork-graph/limitations-and-considerations/ |
| Object types | https://developer.atlassian.com/platform/teamwork-graph/api-reference/object-types/overview/ |
| GraphQL & Cypher | https://developer.atlassian.com/platform/teamwork-graph/graphql-and-cypher/ |
| Connector SDK | https://developer.atlassian.com/platform/teamwork-graph/connector-reference/overview/ |
| `rovo:agent` | https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/ |
| `rovo:skill` | https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-skill/ |
| `rovo:mcp` | https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/ |
| `jira:issuePanel` | https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-issue-panel/ |
| Invocation limits | https://developer.atlassian.com/platform/forge/limits-invocation/ |
| KVS / CES limits | https://developer.atlassian.com/platform/forge/limits-kvs-ce/ |
| Forge SQL limits | https://developer.atlassian.com/platform/forge/limits-sql/ |
| Forge LLM limits | https://developer.atlassian.com/platform/forge/limits-llm/ |
| Platform quotas overview | https://developer.atlassian.com/platform/forge/platform-quotas-and-limits/ |
| Bitbucket events | https://developer.atlassian.com/platform/forge/events-reference/bitbucket/ |
| PvA / no PvV for Forge | https://community.developer.atlassian.com/t/free-forge-app-with-a-paid-plan-sold-on-our-own-site-via-a-merchant-of-record-permitted-or-must-it-be-paid-via-atlassian/103068 |
| `requestTeamworkGraph` bridge | https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/requestTeamworkGraph/ |
| Forge LLMs API | https://developer.atlassian.com/platform/forge/runtime-reference/forge-llms-api/ |
