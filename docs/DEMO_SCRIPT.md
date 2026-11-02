# Demo script — 3 minutes

**Format:** 1080p, screen recording, cursor visible, captions burned in.
**Rule:** every claim shown on screen is either a test result or a citation. Nothing is asserted verbally that the video does not show.

---

## Pre-flight (before recording)

```bash
# 1. Sandbox host, file-driven case base with SQL ledger
CASCADE_STORE=sqlite CASCADE_DB=/tmp/demo.db npx tsx scripts/serve.ts
# → http://127.0.0.1:4173

# 2. Prove the runner fails the build on a violation, off-camera
npx tsx scripts/run-decisions.ts --dir examples/decision-repo/.decisions --root examples/decision-repo
# → exit 1

# 3. Warm both tabs so nothing loads on camera
open http://127.0.0.1:4173
open examples/decision-repo/.decisions/0031-datastore-monitoring.decision
```

Have these windows ready: terminal (large font), browser at :4173, editor with `.decisions/`.

---

## Beat 1 — the claim (0:00–0:25)

**Show:** editor, `0031-datastore-monitoring.decision`.

> "This is a decision. Not a document with a date on it — a decision with a test."

Highlight the `tests:` block, then the `on_fail` line.

> "It says every datastore ships with `pg_stat_statements`. And it says what it means if that stops being true: *this decision is not being followed.*"

**Do not** explain the product yet. Show the artefact.

---

## Beat 2 — the build fails (0:25–0:55)

**Show:** terminal.

```bash
npx tsx scripts/run-decisions.ts --dir examples/decision-repo/.decisions --root examples/decision-repo
```

```
decisions: 6   enforced: 4   violated: 1   orphaned: 1
testability: 83%

✗ 0031-datastore-monitoring  violated  file not found: infra/monitoring/datastore.yaml
— 0055-feature-flags-…       orphaned  no tests
```

> "Six decisions. Four still hold. One is violated — the code drifted from the decision, and the build is red because of it. One is orphaned: nobody wrote a test, so the case base cannot learn from it. We report that instead of hiding it."

Point at the exit code: `exit=1`.

> "That is the whole enforcement mechanism. No dashboard to check. The pipeline fails."

---

## Beat 3 — the case base (0:55–1:40)

**Show:** browser at :4173 → **Case base** tab.

> "Every run accumulates. This is the memory."

Point at the four stats: enforced / violated / orphaned / testable %.

**Growth curve** — hover each bar:

> "Confidence in the leading pattern, as decisions are added. Three clean cases: 0.80 — not 1.00, because three data points is not certainty. Laplace smoothing."
>
> "The fourth decision is violated. 0.67. The fifth holds. 0.71. The sixth is orphaned — and the curve doesn't move, because a decision nobody can check teaches nothing."

**Patterns list:**

> "The pattern isn't a vibe. Four held, one refuted, and here are the exact decision ids it's built from."

**Click decision 0012** → expands:

> "Similar decisions, with reasons — shared domain `datastore`, shared constraint `#no-downtime`. Not a cosine score. You can argue with it."

---

## Beat 4 — the outcome trail (1:40–2:15)

**Show:** scroll to **Outcome trail**.

> "How does a violated decision reach Jira without either side sharing a database?"

Point at the build row: `decision/0031-datastore-monitoring`, state `FAILED`.

> "The runner publishes a commit status named `decision/<id>`. Atlassian already syncs Bitbucket builds into Teamwork Graph. So the join key rides inside the name — and we read the neighbourhood: the build, the work item it touched, the PR, the deployment."

Point at `0012` build `SUCCESSFUL` next to `0031` `FAILED`.

> "Two decisions, two outcomes, one graph. No connector, no workspace scope, no shared SQL."

---

## Beat 5 — the reconstruction (2:15–2:50)

**Show:** browser → **Reconstruction** tab → **Run Cascade**.

> "The same evidence, read backwards."

Point at the tree, then the **Then vs now** tab.

> "Knowable at the time on the left; viable in hindsight on the right. Same objects, two vantage points. The gap is the finding."

Change **Horizon** from *Weeks* to *Years* → run again.

> "Same evidence, different goal, different recommendation. That's why it isn't hindsight bias."

---

## Beat 6 — close (2:50–3:00)

**Show:** the manifest modules, scrolling past `rovo:agent`, `rovo:skill`, `rovo:mcp`, `jira:dashboardGadget`, `confluence:contentBylineItem`.

> "Decisions in the repo. Outcomes in the graph. Memory in the app. The agent's skill library is the record of decisions that survived contact with the codebase."

End card: repo URL + `Decision as Code`.

---

## Things to say only if true on the day

- "Live Teamwork Graph" — only after a real call is verified.
- "Installed in Jira" — only if the module is actually mounted.
- Otherwise use the honest framing: *"the sandbox runs the identical engine; the Forge surfaces are wired and awaiting site verification."*

Do not claim MCP, do not claim the Confluence write, unless demonstrated.

---

## Shot list

| # | Time | Surface | Must be visible |
|---|---|---|---|
| 1 | 0:00 | editor | `tests:` and `on_fail` |
| 2 | 0:25 | terminal | violated + orphaned lines, `exit=1` |
| 3 | 0:55 | :4173 case base | stats, growth bars, patterns |
| 4 | 1:20 | case base | expanded decision with similar + reasons |
| 5 | 1:40 | case base | outcome trail with `decision/<id>` |
| 6 | 2:15 | reconstruction | tree, then/now, horizon flip |
| 7 | 2:50 | manifest | module list |
