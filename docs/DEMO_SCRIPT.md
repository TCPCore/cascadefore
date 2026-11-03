# Demo script — 2:30

**Format:** 1080p, screen recording, cursor visible, captions.
**Rule:** every claim on screen is either a test result, a live MCP response, or a URL the viewer can open. Nothing is asserted verbally that the video does not show.

---

## The sentence the video is built around

> The demo reconstructs a decision from a thread three humans wrote in 2022 and forgot about — not from an ADR we composed, from prose. The judge can open page `2129941` and read the same three comments.

Everything below serves that sentence.

---

## Pre-flight (before recording)

```bash
# Sandbox on real recorded data: CX-11 + Confluence page 2129941 + its 3 comments
CASCADE_SOURCE=live CASCADE_STORE=sqlite CASCADE_DB=/tmp/demo.db npx tsx scripts/serve.ts
# → http://127.0.0.1:4173

# The source of the demo, open in a second tab
open "https://one-atlas-xoan.atlassian.net/wiki/spaces/MD/pages/2129941"

# The runner, to prove a decision can fail a build
npx tsx scripts/run-decisions.ts --dir examples/decision-repo/.decisions --root examples/decision-repo
# → exit 1
```

Windows ready: browser at `:4173`, Confluence page `2129941`, terminal with large font.

---

## Beat 1 — the artefact (0:00–0:20)

**Show:** `examples/decision-repo/.decisions/0031-datastore-monitoring.decision`, `tests:` block visible.

> "A decision that carries its own test. Not a document with a date on it — an assertion about the system, with a defined meaning if it stops being true."

Highlight `on_fail`.

---

## Beat 2 — the build fails (0:20–0:45)

**Show:** terminal.

```
decisions: 6   enforced: 4   violated: 1   orphaned: 1
testability: 83%
✗ 0031-datastore-monitoring  violated  file not found: infra/monitoring/datastore.yaml
— 0055-feature-flags-…       orphaned  no tests
exit=1
```

> "One decision no longer holds, so the pipeline is red. One is orphaned — nobody wrote a test, so the case base cannot learn from it. We report that rather than hide it."

---

## Beat 3 — the real thread (0:45–1:15)

**Show:** Confluence page `2129941` in the browser. Scroll to the three comments.

> "This is a real page. Three comments, written in 2022 by three people, about whether Finance should be on the mobile onboarding list."

Read them aloud, in order:

- *"Would that be you?"*
- *"we need to add Finance to the list here"*
- *"Yes, for now. We should be getting a dedicated headcount for this project in the upcoming quarter"*

> "That is a decision, an alternative, and a resolution. Nobody ever recorded it as a decision. It has been sitting here for three years."

**Do not** cut away yet — the viewer must see that the source is real and boring.

---

## Beat 4 — the reconstruction (1:15–1:50)

**Show:** `http://127.0.0.1:4173` → **Case base** → run, then the tree.

```
1 decision · 3 branches
  thread  Mobile Development Strategy - Project Charter    | page/2129941
     alt    we need to add Finance to the list here
     alt    Would that be you?
     taken  Yes, for now. We should be getting a dedicated headcount…
```

> "One decision, three positions, and the resolution identified as the branch in force. Not three comments — one decision."

Point at the taken branch.

> "The tool did not pick the first comment. It found the resolution, in plain speech, and marked that as the decision."

Then the projection panel:

> "Every branch is scored on what was knowable then against what proved viable since. The gap is the finding — not a prediction."

---

## Beat 5 — verification the viewer can repeat (1:50–2:15)

**Show:** terminal, MCP call.

```
reconstruct-decision  → { summary, runId }
get-run               → evidenceSource: real_confluence_thread
                        decisions: 1 · branches: 3
```

> "The same reconstruction over MCP, from an external client. It reports its own provenance — `real_confluence_thread` — so a reader can tell a real thread from a fixture without trusting me."

**Show** the case base growth curve for two seconds:

> "And the case base accumulates: three clean cases read 0.80, not 1.00, because that is what three data points are worth."

---

## Beat 6 — close (2:15–2:30)

**Show:** `docs/GRAPH-BOUNDARY.md`, scrolled to the five-instance table.

> "Five times a schema assumption produced output that looked right and was wrong — a label, a property, a relationship name, a comment's identity, and finally our own provenance field. Each was caught by an assertion, not by reading output."

> "Plausible output is not evidence. An assertion is."

End card: repo URL.

---

## Optional shot — the panel (do not block on it)

If the Jira panel mounts, insert 15 seconds after Beat 4 showing the same run on a work item **that has history** — never CX-11, which has none.

If it does not mount, do not mention it. The video is complete without it.

---

## Things never to say unless true on the day

- "Live Teamwork Graph" — only after a resolver-context read succeeds.
- "Installed and working in Jira" — only if the panel is on screen.
- "Attributes outcomes through the graph" — it does not; the graph has no issue→build edge.

The honest framing is stronger: *the graph supplies context, the case base supplies outcome.*
