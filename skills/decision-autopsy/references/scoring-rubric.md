# Scoring rubric

Every number Cascade reports is derived from a counted graph fact. This file exists so any figure can be explained without reading the source.

## Knowability — `W_k`

```
recency(e, decision) = clamp(exp(-ageDays / 180), 0.20, 1.00)
independence(e)      = 1 / sqrt(number of evidence sharing e.independenceKey)
W_k                  = clamp01(Σ authority(e) × recency(e) × independence(e))
```

Only evidence whose `createdAt` is on or before the decision's `decidedAt` contributes. Everything else is listed as *withheld* and contributes zero.

`independenceKey` is the author ARI (or the component ARI when there is no author). Four comments from one person are not four independent facts.

### Authority table

| Evidence type | Authority |
|---|---|
| External build / deployment | 0.95 |
| Confluence page (ADR) | 0.90 |
| External pull request | 0.80 |
| Atlassian goal | 0.75 |
| Confluence comment | 0.65 |
| Jira comment | 0.60 |
| Jira work item | 0.55 |
| Jira status transition | 0.50 |

## Viability — `W_v`

```
field(e)   = implementationProof(e) ? 1.0 : authority(e) × 0.5
outcome(e) = passed → 1.00 · failed → 0.15 · unknown → 0.60
W_v        = clamp01(Σ field(e) × outcome(e) × independence(e))
```

No recency decay here: viability is judged on everything known *now*, which is the point of the comparison.

## Gap

```
gap = W_v − W_k
```

High gap = the organisation had the evidence and did not connect it. Negative gap = the path looked better at the time than it turned out to be; that is a normal, healthy outcome and should be reported as such.

## Path score (forward recommendation)

```
intentFit = 1 − (w.migration × migrationCost + w.residual × residualRisk + w.freshness × (1 − freshness))
score     = (intentFit × applicability − (migrationCost + residualRisk)) × freshness
```

| Horizon | migration | residual | freshness |
|---|---|---|---|
| weeks | 0.60 | 0.25 | 0.15 |
| quarters | 0.40 | 0.40 | 0.20 |
| years | 0.15 | 0.65 | 0.20 |

- `migrationCost` — dependent objects that must be unwound, ÷ 8, capped at 1.
- `residualRisk` — retained spine segments still marked unresolved, ÷ 5, capped at 1.
- `applicability` — share of the path's required dependencies that still resolve today.
- `freshness` — share of the path's evidence not superseded.

## Vetoes

A hard constraint tagged `#no-new-dependency`, `#ship-within-2-weeks`, `#no-schema-change` or `#no-downtime` can disqualify a path outright. A constraint without a recognised tag never vetoes; it is reported as unmapped instead of being guessed at.

## What is never done

- No model output enters any score.
- No branch exists without an ARI.
- No path is described as "what would have happened". The output is always "this alternative was evidenced, and here is what happened where it was tried."
