# Scorecard — evidence per criterion

Every line names where the evidence is, so a reviewer can check it rather than
trust it. Updated 2026-11-06.

---

## Technological Implementation

| Claim | Evidence | Checkable by |
|---|---|---|
| Suite is green | **261 tests**, 24 files | `npm run verify` |
| CI enforces it | `.github/workflows/verify.yml` — typecheck, tests, bundles, smoke, accessibility | push to `main` |
| Both projects typecheck | root `tsc` **and** panel `tsc` in the gate | `scripts/verify.sh` |
| Manifest valid | `forge lint` → *No issues found* | `forge lint` |
| Runs in the Forge runtime | `?action=replay` → pipeline → Forge SQL → read back | production trigger |
| MCP verified end to end | `reconstruct-decision` → SQL → `get-run` on a later call | MCP Inspector |
| 8 MCP tools | search, why, reconstruct, get-run, project-tree, find-precedent, decision-matrix, health | `tools/list` |
| Graph reads verified | 6 queries executed; 3 edges rejected and documented | [GRAPH-BOUNDARY.md](GRAPH-BOUNDARY.md) |
| Graph reachability is now self-reporting | the panel probes Teamwork Graph on load and shows `graph reachable` / `graph no user session` | header badge |
| Projection is deterministic | same run at 2020 → 0 decisions; at 2026 → 4 in force | `?action=project` |
| Counterfactual is time-gated | MongoDB → knownThen 0009 (held), learnedLater 0027 (reverted) | `?action=precedent` |
| Action contract tests | 7 tests hitting the exact handlers MCP calls | `tests/actions.test.ts` |

**Known gaps:** the Rovo agent has not been invoked from a chat surface; a Jira
Automation rule has not been executed; live Teamwork Graph mode from the panel is
unproven (the app runs on the seeded source, labelled as such).

---

## Design

| Claim | Evidence |
|---|---|
| Every view renders | 7 screenshots in `artifacts/shots/`, captured by Playwright from the real bundle |
| Case base, matrix, growth, patterns, outcome trail | `01-case-base.png` |
| Paths not taken renders with reasons and time-gated precedent | `02-paths-not-taken.png` |
| Reconstruction tree | `03-decision-tree.png` |
| Projected tree with as-of control | `04-projected-tree.png` |
| Anchored before the decision: nothing existed | `05-projected-before.png` |
| Actions are labelled, never silent | picker failures show an explicit card; the badge names the data source |
| Judge-facing onboarding | `docs/INSTALL.md`, README screenshots |
| **Accessibility: zero WCAG AA violations** | axe-core across five views — `npm run a11y` |
| **No blank-page regressions** | `npm run smoke` drives every tab and asserts it renders; fails on any page error |
| **Crashes are contained** | `ErrorBoundary` per surface: one broken section, not a white screen |
| **The gate actually gates** | `verify.sh` runs `tsc` directly from the panel; `npm exec` was swallowing the exit code |
| Responsive at 390px | `docs/screenshots/06-mobile.png` |
| Listing hero and video thumbnail | `banner-1280x720.png`, `youtube-thumbnail.png` |

**Known gaps:** the case base repeats its counts in two places (matrix footer and
the stats row) — deliberate, since one is per-area and one is the total.

---

## Potential Impact

| Claim | Evidence |
|---|---|
| Org-wide picture | `?action=matrix` → 6 decisions across 7 areas, 4 enforced / 1 violated / 1 orphaned |
| Orphan rate surfaced, not hidden | the same response; `83% testable` in the UI |
| Onboarding question answered | `?action=why&subject=Postgres` → decisions + rationale |
| Works without changing anyone's habits | reconstruction reads existing threads; the sandbox needs no account |

---

## Innovation

| Claim | Where it is implemented |
|---|---|
| The tree is projected, not stored | `src/domain/treeProjection.ts` — same run, different anchors, different trees |
| Time gate as a hard constraint | `src/domain/timeGate.ts`, applied in `findCounterfactual` |
| `invisibleAfter` — what could not have been known | returned by `project-tree` |
| Decision recovery from prose | `src/graph/extract.ts` — clustering + resolution markers |
| Precedent split by knowability | `src/decisions/alternatives.ts` |

Prior art is named honestly in [SUBMISSION.md](SUBMISSION.md).

---

## Presentation

| Item | Status |
|---|---|
| Demo video | `artifacts/video/demo.webm` — ~100s, 1080p, captioned, recorded from the running product |
| Reproducible | `node scripts/record-demo.mjs` |
| Screenshots | `docs/screenshots/` |
| Install paths | [INSTALL.md](INSTALL.md) |
| Submission text | [SUBMISSION.md](SUBMISSION.md) |

**Remaining (owner action):** upload to YouTube as Public, and paste the URL into
the Devpost form.

---

## Bonus categories

| Category | Status | Evidence |
|---|---|---|
| **Best MCP App** | ✅ strong | verified round trip; 8 tools |
| **Best Teamwork Graph** | 🟡 partial | reads verified; no live panel read; 3 edges documented as unsupported |
| **Best Rovo Agent** | 🟡 declared | agent + skill + 6 actions deployed; **never invoked** |
| **Best Marketplace Published** | 🟡 prepared | listing pack ready; publish action is the owner's |

---

## Honest residual risk

1. **The video is recorded but not reviewed.** I can verify frames, not pacing.
2. **The Rovo agent is declared but unexercised** — do not claim it works.
3. **Judges cannot install without a listing.** Path A (sandbox) is the answer
   and it needs nothing from them.
