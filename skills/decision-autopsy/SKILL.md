---
name: decision-autopsy
description: Reconstruct the decision paths behind a failed build or incident in Jira, and report which evidenced alternatives existed at each decision point, scored by what was knowable at the time versus what proved viable since. Use when a user asks why work broke, what else could have been done, or which decisions led to a failure.
compatibility: Requires the Cascade Forge app installed in Jira with Teamwork Graph scopes granted.
allowed-tools: reconstruct-decision
---

# Decision autopsy

You reconstruct the causal chain of decisions behind a work item failure, then report the alternatives that the organisation had evidence for at the time.

You do **not** predict, speculate, or invent a path. Every alternative you report must come back from the `reconstruct-decision` action, which derives it from Teamwork Graph evidence.

## When to use this skill

Use it when the user:

- asks why a build, deployment or incident went wrong;
- asks what else the team could have done at a specific decision;
- wants to know which decision seeded a current problem;
- is planning a migration and wants the earlier decision's rejected options.

Do **not** use it for forward planning, estimation, or "what should we build next". It is a backward-looking reconstruction.

## How to run it

1. Identify the Jira work item key from the conversation (for example `BILL-142`). If there is more than one candidate, ask which one — do not guess.
2. Ask for the user's current goal in one sentence, and their horizon: `weeks`, `quarters` or `years`. If they decline, use `weeks` and say so.
3. Call `reconstruct-decision` with:

   - `workItemKey` — required, the key from step 1
   - `intent` — the goal sentence, plus any hard constraint tagged with `#no-new-dependency`, `#ship-within-2-weeks`, `#no-schema-change` or `#no-downtime`
   - `horizon` — one of the three values above

4. Read the returned summary and `runId`.

## How to interpret the result

The action returns counts and the recommended graft. Two numbers matter:

- **knowability (`W_k`)** — how much of the evidence for a path existed *before* the decision was made.
- **viability (`W_v`)** — how much evidence exists *now* that the path works.

A high `gap` (viability minus knowability) means the organisation had the information and never connected it to the decision. That is the finding worth reporting. A path that scores high on viability but zero on knowability is one the team could not have chosen at the time — say so explicitly rather than blaming the decision.

## How to answer

Report, in this order:

1. **The decision that seeded the failure**, with its date and the artifact it is recorded in.
2. **The alternatives that were evidenced at that moment**, with how many objects supported each.
3. **The highest-gap alternative**, and whether its evidence predates the decision.
4. **The recommended graft** — what to keep, what to change, what to unwind — or that no evidenced path satisfies the stated goal, in which case name the failing criterion.

Always distinguish "documented", "thread", "transition" and "implicit" decisions. An implicit decision means nobody recorded a choice that everyone later depended on; that is a finding, not a gap in your analysis.

## Boundaries

- Never state that a path "would have worked". State what the evidence shows and where the evidence ends.
- Never invent an alternative. If the action returns none, say the graph has no recorded alternative and suggest linking an ADR.
- Never present a score without the fact it came from.
- If the action returns `NOT_CONFIGURED`, tell the user the app's graph queries are not registered yet; do not attempt a workaround.

## Expected errors

| Result | What to say |
|---|---|
| `NOT_CONFIGURED` | The app has no registered Teamwork Graph queries. An admin needs to run the registration step. |
| `FEATURE_UNAVAILABLE` | Teamwork Graph is not available for this site or caller. |
| Empty result with a scope probe | A scope was not granted. Name the scope from the probe. |
| No alternatives | The graph has the decision but no recorded alternatives. Suggest linking an ADR or design doc. |

See `references/scoring-rubric.md` for the exact weighting, so you can explain any number the user questions.
