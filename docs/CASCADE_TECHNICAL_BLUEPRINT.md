# Cascade — Technical Blueprint

**Version:** 1.0 · **Date:** 1 November 2026 · **Target:** Codegeist 2026, submitted 21 Dec 2026
**Companion doc:** `CASCADE_FORENSIC_PLATFORM_ANALYSIS.md` (platform constraints this blueprint obeys)

---

## 1. Review verdict on the idea

The concept survives review with **one structural change and three narrowings**.

### Survives
- The thesis — *"the failure wasn't a bad decision, it was an unconnected graph"* — is novel, defensible, and directly on-theme for a hackathon whose theme is context.
- Backward causal reconstruction with time-gated evidence is not a forward-prediction wrapper. That distinction is the whole entry.
- It hits three bonus categories with one build: `rovo:skill` (Agents), `rovo:mcp` (MCP), persisted Cypher read + dossier write (Teamwork Graph).

### Structural change (forced by the platform)
**There is no `Decision` object in Teamwork Graph.** The product therefore cannot "query decisions." It must **synthesise decision nodes** from four evidence classes (documented / threaded / transitional / implicit). This synthesis is not a workaround — it is the intellectual property. A competitor cannot copy the feature because the feature *is* the extraction rules plus the scoring model.

### Narrowings
1. **"All available paths" → "evidenced paths."** Combinatorially infinite otherwise, and undemoable. Cap: ≤3 branches per node, ≤6 nodes of spine depth.
2. **No counterfactual simulation.** A branch is never "what would have happened." It is "this alternative is documented, and here is proof it was implemented elsewhere." Speculation is explicitly out of scope and labelled as such in the UI.
3. **No billing.** PvA-only means there is nothing to meter. The revenue story lives in the submission text, not the code.

### What the product must never do
- Let an LLM produce a branch, a score, or a path selection.
- Render a node without an ARI.
- Claim causation. Spine edges are "causal candidates" with a visible link type.

---

## 2. System architecture

| Component | Runtime | Responsibility | Latency budget |
|---|---|---|---|
| `jira:issuePanel` (Custom UI) | Browser iframe | Render tree, then/now, graft lanes; capture intent | — |
| `resolver` | Forge function | Create run, enqueue job, serve run snapshots | ≤25 s |
| `reconstruct` job | Async event function | Traverse → extract → score → rank → persist → write dossier | ≤300 s (`timeoutSeconds`) |
| `runCascade` action | Forge function | Same pipeline, synchronous enough for agent/MCP callers | ≤55 s |
| Teamwork Graph API | Atlassian | Persisted Cypher execution (read-only, as user) | per call |
| Forge SQL | Atlassian | Runs, nodes, edges, evidence, scores | 5 s/statement |
| Forge LLM | Atlassian | Intent text → structured object; dossier prose | ≤25 s |
| Confluence REST v2 | Atlassian | Dossier child page (the graph write-back path) | — |

**Flow**

```
panel → resolver.startRun(issueKey, intentText)
      → async event → reconstruct(runId)
          → TWG: spineQuery, branchQuery, outcomeQuery   (persisted Cypher, paginated)
          → extractDecisionNodes(rows)                   (rules, no LLM)
          → scoreBranches(nodes, evidence, decisionTimes) (pure, tested)
          → parseIntent(intentText)                       (Forge LLM, structured; deterministic fallback)
          → rankPaths(branches, intent, facts)            (pure, tested)
          → buildGraft(...)                               (pure, tested)
          → SQL: persist run snapshot
          → Confluence: write dossier page
      → panel polls resolver.getRun(runId) → renders
```

**Invariant:** every value the panel renders originates from a row in SQL that originated from a graph object with an ARI, except intent fields which carry `intentSource`.

---

## 3. Domain model

```ts
type Ari = string;
type Iso = string;                       // ISO-8601 UTC

type EvidenceType =
  | 'confluence-page' | 'confluence-comment'
  | 'jira-comment'   | 'jira-status'
  | 'jira-work-item' | 'external-build'
  | 'external-deployment' | 'external-pull-request'
  | 'goal';

interface Evidence {
  ari: Ari;
  type: EvidenceType;
  createdAt: Iso;
  lastUpdated?: Iso;
  title: string;
  sourceAuthority: number;   // 0..1, from a fixed table by type+shape
  independenceKey: string;   // author ARI, or component ARI, or page ARI
  implementationProof: boolean;  // built/deployed successfully somewhere
  outcome: 'passed' | 'failed' | 'unknown';
}

type DecisionKind = 'documented' | 'thread' | 'transition' | 'implicit';

interface DecisionNode {
  id: string;                // deterministic: sha1(kind + ari)
  ari: Ari;
  kind: DecisionKind;
  title: string;
  decidedAt: Iso;
  actorAris: Ari[];
  confidence: number;        // rule-derived, 0..1
  evidence: Evidence[];
  supersededAt?: Iso;        // evidence of a later reversal
}

interface Branch {
  id: string;
  nodeId: string;
  label: string;
  taken: boolean;            // true = the spine's actual choice
  evidence: Evidence[];
  downstreamNodeIds: string[];
  requiredDependencies: Ari[];
}

interface BranchScore {
  branchId: string;
  knowability: number;       // W_k
  viability: number;         // W_v
  gap: number;               // W_v − W_k
  confidence: number;        // min(W_k, W_v)
  knowableEvidenceAris: Ari[];
  withheldEvidenceAris: Ari[];   // failed the gate — the "you couldn't have known" pile
  arithmetic: ArithmeticStep[];
}

interface ArithmeticStep { label: string; expression: string; value: number; }
```

**Invariants**
- `Branch.nodeId` must exist in the node set; no orphan branches.
- Every `Evidence.ari` is non-empty and unique within a run.
- `confidence` for `implicit` nodes cannot exceed 0.85 (absence of evidence is weaker than evidence of absence).
- `decidedAt` never exceeds the run's `failureAt`.

---

## 4. Algorithms

### 4.1 Time gate

```
knowable(e, node) ⇔ e.createdAt ≤ node.decidedAt ∧ reachable(e, node)
```

`reachable` is enforced by the Cypher traversal (the edge exists), not re-checked in code. The gate is therefore a single timestamp comparison — auditable in three lines.

Recency weighting (applied only to `W_k`, never `W_v`):

```
recency(e, node) = clamp(exp(-ageDays / 180), 0.20, 1.00)
```

### 4.2 Knowability and viability

Both use the same aggregation so the comparison is fair:

```
contribution(e) = field(e) × recency(e) × independenceDiscount(e)
independenceDiscount(e) = 1 / sqrt(count of evidence in run sharing e.independenceKey)
W = clamp01(Σ contribution)
```

| Weight | `field(e)` |
|---|---|
| `W_k` | `e.sourceAuthority` |
| `W_v` | `implementationProof ? 1.0 : e.sourceAuthority × 0.5`, then × `outcomeFactor` |

`outcomeFactor` = `passed → 1.0`, `failed → 0.15`, `unknown → 0.60`.

`gap = W_v − W_k`; `confidence = min(W_k, W_v)`.

**Interpretation:** high gap = viable *and* unconnected. That is the product's unit of insight.

### 4.3 Path facts (graph-derived, never judged)

| Fact | Derivation |
|---|---|
| `migrationCost` | count of graph objects depending on the spine segments this branch contradicts, normalised by `min(1, n/8)` |
| `residualRisk` | count of retained-prefix nodes whose own `confidence < 0.6`, normalised by `min(1, n/5)` |
| `applicability` | fraction of `requiredDependencies` still resolvable at `now` |
| `freshness` | fraction of branch evidence not superseded at `now` |
| `intentFit` | policy function below |

### 4.4 Intent policy (transparent, not learned)

```ts
weights = {
  weeks:   { migration: 0.60, residual: 0.25, freshness: 0.15 },
  quarters:{ migration: 0.40, residual: 0.40, freshness: 0.20 },
  years:   { migration: 0.15, residual: 0.65, freshness: 0.20 },
}[intent.horizon];

intentFit = 1 − (w.migration·migrationCost + w.residual·residualRisk + w.freshness·(1−freshness));
```

Hard-constraint violations are a **veto**, not a deduction.

### 4.5 Forward score and graft

```
Score(p) = (intentFit × applicability) − (migrationCost + residualRisk)
final    = Score(p) × freshness
```

Hard veto ⇒ `disqualified: true`, excluded from ranking but still shown (never hidden).

Graft assembly: choose the highest-scoring non-disqualified path; split the spine at its divergence node into `keep` (prefix), `graft` (branch), `unwind` (contradicted segments with dependent counts). If every path is disqualified, return `noEvidencedPath` with the closest path and its failing criterion.

---

## 5. Graph layer

Three persisted Cypher queries. All paginated at ≤25 rows; loops driven by `hasNextPage`.

| Key (config) | Purpose | Object types touched → required scopes |
|---|---|---|
| `spine` | failing work item → linked pages → page comments → authors → sibling work items | `issue:jira`, `page:confluence`, `comment:confluence`, `issue-comment:jira`, `user:atlassian` |
| `branches` | sibling components' decisions + unanswered comment threads + later reversal tickets | `issue:jira`, `issue-comment:jira`, `page:confluence`, `comment:confluence` |
| `outcomes` | builds/deployments/PRs on those paths, success/failure | `build:external`, `deployment:external`, `pull-request:external`, `commit:external` |

**Registration is idempotent** on query text — `registerQueries.ts` runs on every deploy and stores keys in KVS. A 1-minute propagation window means the app must retry `QUERY_NOT_FOUND` with backoff.

**Failure modes handled**
- `QUERY_NOT_FOUND` → retry ×3, then surface `graph_unavailable`.
- Empty result → run a **scope probe** (one row per object type) and report *which* scope is missing. Never present empty as "no data."
- Partial page with `hasNextPage` → loop, don't trust row count.

---

## 6. Storage schema

```sql
CREATE TABLE IF NOT EXISTS runs (
  run_id VARCHAR(64) PRIMARY KEY,
  work_item_ari VARCHAR(255) NOT NULL,
  work_item_key VARCHAR(64) NOT NULL,
  failure_at DATETIME NOT NULL,
  status VARCHAR(24) NOT NULL,
  intent_json JSON,
  intent_source VARCHAR(24),
  created_at DATETIME NOT NULL,
  completed_at DATETIME,
  error_code VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS nodes (
  run_id VARCHAR(64) NOT NULL,
  node_id VARCHAR(64) NOT NULL,
  ari VARCHAR(255) NOT NULL,
  kind VARCHAR(24) NOT NULL,
  title VARCHAR(512) NOT NULL,
  decided_at DATETIME NOT NULL,
  confidence DOUBLE NOT NULL,
  PRIMARY KEY (run_id, node_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  run_id VARCHAR(64) NOT NULL,
  ari VARCHAR(255) NOT NULL,
  node_id VARCHAR(64),
  type VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL,
  authority DOUBLE NOT NULL,
  independence_key VARCHAR(255) NOT NULL,
  proof TINYINT NOT NULL DEFAULT 0,
  outcome VARCHAR(16) NOT NULL DEFAULT 'unknown',
  PRIMARY KEY (run_id, ari)
);

CREATE TABLE IF NOT EXISTS branches (
  run_id VARCHAR(64) NOT NULL,
  branch_id VARCHAR(64) NOT NULL,
  node_id VARCHAR(64) NOT NULL,
  label VARCHAR(255) NOT NULL,
  taken TINYINT NOT NULL,
  score_json JSON,
  PRIMARY KEY (run_id, branch_id)
);

CREATE TABLE IF NOT EXISTS paths (
  run_id VARCHAR(64) NOT NULL,
  path_id VARCHAR(64) NOT NULL,
  rank INT NOT NULL,
  score DOUBLE NOT NULL,
  disqualified TINYINT NOT NULL,
  graft_json JSON,
  PRIMARY KEY (run_id, path_id)
);
```

No foreign keys (unsupported). Cascade deletes are manual. `run_id` is a ULID-ish `Date.now()+random` — sortable, no dependency.

---

## 7. Interface specification

Four states, one screen. No routing.

| State | Content |
|---|---|
| `idle` | Issue summary, failure evidence found?, intent form (goal + horizon + constraints), `Run Cascade` |
| `running` | Skeleton tree, stage label (`traversing` → `scoring` → `ranking`), elapsed |
| `loaded` | Three stacked views + dossier link |
| `empty` | `noEvidencedPath` explainer naming the failing criterion and the scope probe result |

**View 1 — Cascade tree.** Spine vertical, branches to the right. Node = ARI chip, kind badge, confidence pill, decision date. Branch = label, `Gap` badge, evidence count. Max 4 visible levels; deeper levels collapse.

**View 2 — Then / Now.** Two columns, one row per branch. Left: `W_k` and the knowable ARIs. Right: `W_v` and the withheld ARIs. This is the hindsight-bias defence, rendered.

**View 3 — Keep / Graft / Unwind.** Three lanes with object counts and a copyable migration checklist.

**Evidence chip hover:** the `ArithmeticStep[]` verbatim, e.g. `authority 0.90 × recency 0.74 × independence 0.71 = 0.47`.

**Never rendered:** raw JSON, an unlabelled score, a node without an ARI, an expanded branch with zero evidence.

---

## 8. Rovo packaging

| Surface | Artefact | Constraint |
|---|---|---|
| `rovo:skill` | `skills/decision-autopsy/SKILL.md` + `references/scoring-rubric.md` | ≤500-line body, no scripts, description ≥50 chars |
| `rovo:agent` | `resource/agent/prompt.txt` via `prompt: resource:` | name ≤30 chars, Forge CLI ≥10.6.0 |
| `rovo:mcp` | 1 module, 1–3 tools | max 50 tools, name ≤30 chars, admin-enabled exposure |

The action `reconstruct-decision` is the single tool exposed everywhere. Packaging is a manifest concern only — no duplicated logic.

---

## 9. Build order

| Step | Deliverable | Exit criterion |
|---|---|---|
| 1 | Config + manifest + types | `tsc --noEmit` clean |
| 2 | Domain: time gate, scoring, intent, graft | unit tests green |
| 3 | Graph: queries, client, extractor | extractor fixture test green |
| 4 | Storage: schema + repository | repo tests green against fake driver |
| 5 | Job + resolver + action | `forge lint` clean |
| 6 | Panel | `vite build` succeeds |
| 7 | Rovo artefacts | `forge lint` still clean |
| 8 | Docs, seed plan, runbook | install steps readable by a stranger |

---

## 10. Acceptance tests (definition of done)

1. Given a fixture tree and `horizon=weeks`, the top path differs from `horizon=years`, and both are non-disqualified.
2. Every rendered branch has ≥1 ARI; a branch with none is unrenderable by type.
3. A branch whose only evidence postdates `decidedAt` scores `W_k = 0` and appears under "couldn't have known."
4. `noEvidencedPath` triggers when all paths violate a hard constraint.
5. Pagination loop terminates and reports `hasNextPage` correctly when a page returns 3 of 25 rows.
6. Scope probe names a missing scope in the `empty` state.
7. Scoring module does not import `@forge/llm` (lint rule / import test).

---

## 11. File tree (as built)

```
CASCADE/
├── manifest.yml
├── package.json · tsconfig.json · vitest.config.ts · .gitignore
├── docs/
│   ├── CASCADE_FORENSIC_PLATFORM_ANALYSIS.md
│   └── CASCADE_TECHNICAL_BLUEPRINT.md
├── src/
│   ├── shared/{types.ts,dtos.ts,ids.ts,hash.ts}
│   ├── domain/{timeGate.ts,scoring.ts,intent.ts,graft.ts,constants.ts}
│   ├── graph/{queries.ts,client.ts,extract.ts,registerQueries.ts}
│   ├── storage/{schema.ts,runs.ts,driver.ts}
│   ├── jobs/reconstruct.ts
│   ├── actions/runCascade.ts
│   ├── resolvers/index.ts
│   ├── llm/intentParser.ts
│   └── config.ts
├── static/panel/{package.json,vite.config.ts,index.html,src/*}
├── skills/decision-autopsy/{SKILL.md,references/scoring-rubric.md}
├── resource/agent/prompt.txt
└── tests/*.test.ts · tests/fixtures/*.ts
```
