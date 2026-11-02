# Jira mount diagnosis — why the panel never rendered

**Date:** 2 Nov 2026 · **Status:** RESOLVED — working as designed, not a defect in the app

---

## The finding

`jira:issuePanel` and `jira:issueContext` do **not** render automatically. In the 2026 Jira work-item view, every app entry point is collapsed into an **"Apps" panel in the sidebar**, and a user must explicitly open it and expand the module.

That is why `forge logs` showed **zero invocations**: nothing ever asked the module to load. Not a deployment failure, not a scope conflict, not a demo-site limitation.

## The evidence

### 1. The identical symptom, solved — community thread

A developer reported exactly our situation, on 23 Oct 2026: clean `forge lint`, successful deploy, app visible under *Connected apps → Installed apps*, **zero network requests** to the app's ecosystem domain, `forge tunnel` receiving nothing.

> "Solved. I had to manually add the app on my issue."
> — [Jira Issue-Panel module never renders on any issue](https://community.developer.atlassian.com/t/jira-issue-panel-module-never-renders-on-any-issue-tried-custom-ui-and-unmodified-ui-kit/103436)

### 2. It is intended, and Atlassian declined to change it

> "In Forge apps using the `jira:issuePanel` module, **the panel is hidden by default and only becomes visible after a user manually clicks 'Open or Add Apps.'** This is a significant behaviour gap compared to Atlassian Connect, where issue panels were visible by default."
> — [ECO-1643](https://jira.atlassian.com/browse/ECO-1643), status: **Not Being Considered**

The request for a `defaultOpen` manifest option was closed as *will not be worked on in the foreseeable future*. There is no manifest flag that makes a panel auto-open. Waiting for one is not a plan.

### 3. Work Item View 2.0 moved app surfaces into a sidebar

Jira engineering, on the new view:

> "As of now Marketplace Apps will be hidden again and **users need to manually open the 'Apps' panel**."
> — [Work Item View 2.0 for Ecosystem Partners](https://community.developer.atlassian.com/t/work-item-view-2-0-for-ecosystem-partners/102697)

Two further facts from that thread that affect us:

- **`jira:issueContext` now lives in the Apps sidebar section**, not in the right-hand field column, in the modern view.
- **`dynamicProperties` is never invoked in the new view** — a known gap still under investigation (Oct 2026). So a `status` badge on the collapsed module cannot be relied on.

## What the exact click path is

On a work item, in the modern view:

1. Open the work item.
2. Open the **Apps** panel in the sidebar (collapsed by default; the open/closed state is remembered per user, per window).
3. Expand **Cascade**.

`jira:issuePanel` appears under the same **Apps** entry, not in the ••• menu as documented for the classic view.

## Why this is a product problem, not just a test problem

Three consequences that change the plan:

1. **Discoverability tax on every judge.** A judge must find the Apps panel, expand it, and click through. That is two hidden clicks before they see anything, and it is the same for every Forge app at this hackathon.
2. **No auto-rendering issue surface exists.** With `defaultOpen` declined, there is no manifest option to fix it.
3. **`dynamicProperties` cannot signal "there is something here"** in the new view, so we cannot even badge the collapsed entry.

## What actually renders without a manual add

| Module | Visibility | Notes |
|---|---|---|
| `jira:issuePanel` | manual | requires "Open or Add Apps" per issue |
| `jira:issueContext` | manual | now inside the Apps sidebar section |
| `jira:globalPage` | top-nav **Apps** menu | one click, app-level, not per issue |
| `jira:dashboardGadget` | **immediate** | renders on the dashboard as soon as an admin adds the gadget once |
| `jira:projectPage` | project tab | visible on the project, no Apps panel |
| `confluence:contentBylineItem` | **immediate** | renders on every page it is scoped to |
| Rovo agent | **immediate** | reachable from Rovo Chat, no Apps panel at all |

**Conclusion:** for first-run discovery, the app must not depend on `jira:issuePanel`. The three surfaces that render without a manual per-item click are a **dashboard gadget**, a **Confluence byline item**, and the **Rovo agent**.

## Decision

1. Keep `jira:issueContext` and `jira:issuePanel` — they work once opened, and the demo script will show the click path honestly.
2. **Add `jira:dashboardGadget`** — a "Decision health" gadget is visible on a dashboard immediately, and it is a better first-run surface than a per-issue panel anyway.
3. **Add `confluence:contentBylineItem`** — decisions render on the page itself.
4. **Lead the demo with the Rovo agent and the standalone host**, which have no discovery tax.

This is also a better story for judges: *"Atlassian's 2026 work-item view hides app surfaces behind a manual Apps panel (ECO-1643, declined). So we didn't build a panel-first product. The decision plane surfaces where the work already is — a dashboard gadget, the page byline, and the agent."*
