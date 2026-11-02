# Spike: can `.decisions/` and the Jira panel share one Forge app?

**Run:** 2 Nov 2026 · **Result: NO on all three tests.** Two of them for reasons worse than the scope rule.

---

## Test 1 — workspace scope + site scope in one manifest

**Result: FAIL.** Already observed empirically this week, before this spike:

```
manifest.yml
0:0  error  Workspace scopes can not be used with site scopes  MANIFEST_INVALID_RULE
```

`read:repository:bitbucket` is a workspace scope. Every Jira and Confluence scope is a site scope. They cannot coexist in one manifest. Reproduced by adding the scope to `manifest.yml` and running `forge lint`.

## Test 2 — same, under multi-app compatibility

**Result: FAIL, and for a better reason.** Multi-app compatibility cannot help, because **Bitbucket is not a supported optional app at all**:

> "Only Confluence and Jira are supported. One must be required; the other can be optional."
> — [App compatibility](https://developer.atlassian.com/platform/forge/app-compatibility/)

There is no `app.compatibility.bitbucket` in the current model. Global Apps (EAP) mention Bitbucket connections as *planned* for EAP, but the EAP is not available to us and would not be shippable in 7 weeks.

**Consequence:** a Forge app that reads repository files is a **Bitbucket-only app**. It cannot also render Jira panels. That is not a scope-policy annoyance; it is the compatibility model.

## Test 3 — two apps sharing a Forge SQL case base

**Result: FAIL. Impossible, and this one matters most.**

> "Forge SQL provisions a single database instance per installation."
> "Only your app can read and write your stored data."
> "Data stored by your Forge app for one Atlassian app is not accessible from other Atlassian apps."
> — [Forge SQL](https://developer.atlassian.com/platform/forge/storage-reference/sql/)

Two distinct Forge apps cannot see each other's SQL. There is no shared-database pattern. So the "decision plane with a shared Forge SQL case base" — the fallback pitch in the blueprint — **is not buildable either**.

---

## What this actually means

The blueprint's architecture is dead in both of its forms:

| Design | Status |
|---|---|
| One app: `.decisions/` reader + Jira panel + Rovo | **impossible** — workspace/site scope split, and Bitbucket is not a multi-app option |
| Two apps sharing Forge SQL | **impossible** — SQL is per-app, per-installation |
| Two apps, case base in **Confluence** | **viable** — both can hold site scopes |
| One app, decisions authored **in Confluence** | **viable, simplest** |

The only shared substrate available to two Forge apps on the same site is **site content** — Confluence pages and Jira work items. That is the real constraint, and it inverts the design: the case base cannot be a private database. It has to be *content*.

Which is, awkwardly, better for the pitch: a decision record a human can open, edit, and link beats a row in a table nobody can see.

---

## The three viable architectures, ranked

### A. Decisions in Confluence, one app (recommended)

`.decision` semantics live in a Confluence page with a structured body (or a Confluence *database*, which is a first-class Teamwork Graph object type). One Forge app holds Jira + Confluence scopes, owns the case base in Forge SQL, and renders surfaces everywhere.

- **Cost:** lose repo co-location. The decision is not next to the code.
- **Gain:** shippable today; the case base is inspectable; the graph already indexes it; no new app, no new consent flow.
- **Test kinds available:** `graph`, `http`, `manual`. (`file_match` is out — no repo access.)

### B. Two apps, Confluence as the bus

A Bitbucket-only app reads/writes `.decisions/` files and mirrors them to Confluence. The Jira/Confluence app reads Confluence and owns the case base.

- **Cost:** +2–3 days, a second install and consent flow, eventual consistency, a mirror to keep honest.
- **Gain:** decisions stay beside the code, which is the whole "as code" premise.
- **Risk:** the mirror is the weak point; a judge will ask who wins on conflict.

### C. Bitbucket app only

`.decisions/` reader with a Bitbucket UI, no Jira panel.

- **Cost:** loses Jira, Teamwork Graph surfaces, Rovo agent value, and two bonus categories.
- **Gain:** honest to "as code"; cheapest to build.
- **Verdict:** not competitive for this hackathon.

---

## Recommendation

**Build A now, keep B as the post-hackathon path.**

Reason: A is buildable in the remaining days with what already exists, and every domain piece — parser, runner, status lifecycle, Laplace confidence, pattern extraction, retrieval — is **identical in A and B**. The only thing that differs is where the decision text comes from. So building the brain first is not a bet on either architecture; it is the shared 70% of both.

The pitch adjusts by one word: decisions are **assertions**, not files. *"Decision as Assertion: every decision carries an executable test of whether it still holds; the case base is the record of which ones did."*

That survives the constraint, and it is still not what anyone else is shipping.

---

## Addendum: two schema corrections for the case base

1. **No `AUTO_INCREMENT`** — the Forge SQL docs explicitly warn it hot-spots on TiDB. Use `AUTO_RANDOM` or a UUID in `BINARY(16)`.
2. **Schema management** — the supported path is `migrationRunner.run()` from `@forge/sql`, not hand-rolled `CREATE TABLE IF NOT EXISTS`. Our current `ensureSchema` works but is debt.
