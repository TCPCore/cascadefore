# Architecture

**Decision as Code.** Six parts, one loop. Everything below is implemented in this repository and covered by tests, except where marked *unverified*.

---

## 1. The loop

```
 .decisions/*.decision          the decision and its tests (git = source of truth)
        │  push
        ▼
 runner (scripts/run-decisions.ts)     parse → execute → report
        │
        ├── commit status  decision/<id>   ──▶ Teamwork Graph ExternalBuild
        │                                        (synced by Atlassian, not by us)
        └── Confluence page  "Decision record: <id>"
                              (prose + fenced YAML)
        │
        ▼
 case base (Forge SQL)          outcomes, patterns, growth curve
        │
        ├── Jira panel / dashboard gadget / Confluence byline
        ├── Rovo agent + skill
        └── MCP (4 tools)
```

The join key is the string `decision/<id>`. It rides inside a commit-status name, which Atlassian already syncs into Teamwork Graph. **No shared database, no cross-app call, no connector, no workspace scope.**

## 2. Why it is shaped this way

Three platform facts forced every design decision:

| Fact | Consequence |
|---|---|
| Workspace scopes cannot coexist with site scopes in one manifest, and Bitbucket is not a multi-app option | The repo reader is a CI step, not a Forge app |
| Forge SQL is per-installation and unreadable by other apps | The case base lives in exactly one app; the API and Confluence are the only shared surfaces |
| Forge functions have no shell | `shell` tests run in Pipelines, where shell already exists |

Everything else follows from choosing the mechanism the platform already provides instead of rebuilding it.

## 3. Components

### 3.1 Decision artifact — `src/decisions/`

- `types.ts` — `Decision`, `DecisionTest` (5 kinds), `TestResult`, `Pattern`
- `parse.ts` — YAML parser, fenced-block extraction, validation with field-level errors
- `runner.ts` — executor registry, `statusOf`, `runDecision`, `runAll`
- `retrieval.ts` — structured similarity: domain + constraints + terms, **with reasons**
- `patterns.ts` — per-part bucketing, Laplace confidence, ratio guard, growth curve
- `service.ts` — one pass → `{ models, report }`
- `store.ts` / `schema.ts` — portable SQL ledger

**Status is derived, never authored:**

```
no runnable test        → orphaned
all runnable tests pass → enforced
any runnable test fails → violated
```

`manual` tests never count. A decision whose only test is a note is a decision the case base cannot learn from, and the product says so out loud.

### 3.2 Runner — `src/runner/` + `scripts/run-decisions.ts`

```
--dir .decisions --root . --emit-statuses statuses.json
--json  --no-strict  --graph sandbox
```

Exit 1 on any violation or parse error. Emits commit-status payloads so the pipeline posts them with `curl` — the runner never holds a Bitbucket token.

Executors: `file_match` (repo), `http` (live fetch), `graph` (persisted Cypher). No `shell` executor: the pipeline step *is* the shell.

### 3.3 Mirror — `src/mirror/`

- `page.ts` — renders prose + a fenced YAML block that **parses back to the original decision**
- `storage.ts` — Confluence storage-format round trip (code macro ⇄ fence)
- `sync.ts` — idempotent create/update by content, not timestamp
- `ingest.ts` — page → decision, with title/body mismatch detection
- `confluenceTarget.ts` — REST adapter (*unverified live*)

Round-trip fidelity is a test: repo → mirror → ingest → re-run produces identical statuses.

### 3.4 Attribution — `src/attribution/` + `ATTRIBUTION_QUERY`

Reads the neighbourhood of a `decision/<id>` build: repository, work items, pull requests, deployments. The mapper drops anything without an ARI — the UI never renders a claim it cannot cite.

### 3.5 Case base storage — `src/storage/sqliteDriver.ts`, `src/decisions/store.ts`

Portable DDL: no `AUTO_INCREMENT`, no `JSON` columns, no `ON DUPLICATE KEY UPDATE`, no foreign keys. Writes are delete-then-insert so TiDB and SQLite behave identically. A test asserts MySQL-only syntax *fails* in the sandbox, which is why it is banned.

`node:sqlite` gives a real SQL engine locally, so the DDL and every statement execute before they reach TiDB.

### 3.6 Surfaces

| Surface | Module | Renders without a manual click? |
|---|---|---|
| Dashboard gadget | `jira:dashboardGadget` | ✅ yes |
| Confluence byline | `confluence:contentBylineItem` | ✅ yes |
| Rovo agent | `rovo:agent` + `rovo:skill` | ✅ yes (via Rovo Chat) |
| MCP | `rovo:mcp`, 1 module, 1–4 tools | ✅ yes (external clients) |
| Issue context / panel | `jira:issueContext` / `jira:issuePanel` | ❌ behind the Apps panel (`ECO-1643`, declined) |

This is why the product is not panel-first: the 2026 work-item view hides app surfaces behind a manual "Apps" panel.

## 4. Sandbox layers

| Layer | Command | What is real |
|---|---|---|
| Offline artifacts | `npm run serve:web` → :4173 | panel, engine, case base, ledger |
| Recorded graph | `CASCADE_SOURCE=recorded` | transport, paging, retries, mapping |
| SQL ledger | `CASCADE_STORE=sqlite CASCADE_DB=…` | DDL and every statement |
| Forge development | `forge deploy -e development` | modules, scopes, consent |
| Demo tenant | provisioned site | everything Atlassian-side |

Production is reserved for the demo recording.

## 5. Invariants (enforced by tests)

1. A branch or decision without an ARI cannot render.
2. Status is computed from results; a stored status is ignored on read.
3. Test *specs* live in git; the ledger holds only observations.
4. A pattern needs ≥3 supporting cases **and** ≥60% of the comparable population.
5. Confidence is Laplace-smoothed: three clean cases read 0.80, not 1.00.
6. Retrieval always explains itself.
7. The mirror cannot lose a test: repo → page → repo round-trips.
8. A malformed decision file never stops the run; it is reported alongside the good ones.

## 6. What is not verified

- No live Teamwork Graph call (scopes granted, query not yet executed).
- No live Confluence write (adapter written, untested).
- No live Jira module mount (blocked by the Apps-panel behaviour).
- No MCP client connection (exposure toggle available, not enabled).
- No `shell` execution anywhere: unsupported in Forge, deferred in CI.
