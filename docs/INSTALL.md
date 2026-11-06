# Install — judge and evaluation paths

Two paths. **Path A needs no Atlassian account and no approval.** Path B is the
real thing inside a customer site.

---

## Path A — evaluate in 60 seconds, no account

```bash
git clone https://github.com/TCPCore/cascadefore
cd cascadefore
npm install
npm --prefix static/panel install

# Real recorded Teamwork Graph payloads: CX-11, Confluence page 2129941, its 3 comments
CASCADE_SOURCE=live CASCADE_STORE=sqlite CASCADE_DB=/tmp/cascade.db npx tsx scripts/serve.ts
#  → http://localhost:4173
```

What you can check without any Atlassian setup:

| Tab | What it shows |
|---|---|
| **Case base** | The decision matrix (6 decisions, 7 areas, 4 enforced / 1 violated / 1 orphaned), growth curve, patterns, outcome trail |
| **Case base → open a decision** | Its test and result, plus **Paths not taken**: SQLite and MongoDB, each with the reason it was rejected and the precedent split by the time gate |
| **Reconstruction → Run** | Decision tree, Then vs now, Paths compared |
| **Projection tab** | Change the *As of* date and the tree recomputes: before the decision nothing existed, after it four decisions are in force |

The provenance badge says `SEEDED DATA` or `real Confluence thread`, so you always
know which kind of evidence you are looking at.

---

## Path B — install on an Atlassian site

### Option B1: your own site (developer)

```bash
forge login
forge deploy -e development
forge install --upgrade -e development -p Jira \
  --site <your-site>.atlassian.net --confirm-scopes
```

Then open Jira → **Apps → Cascade** (or Jira Settings → Apps → Cascade).

### Option B2: a judge installing on their site

A shareable installation link is produced by a **Marketplace listing**, not by the
CLI. To generate one:

1. https://developer.atlassian.com/console/myapps/ → your app → **Distribution**
2. Choose **Unlisted** (allowed for hackathons) or Public
3. Fill the listing from [MARKETPLACE_LISTING.md](MARKETPLACE_LISTING.md)
4. Submit for review → copy the **Install link** shown on the listing
5. Put that link in the Devpost submission

Until a listing exists, judges can only use **Path A**. That is why Path A is the
primary evaluation route and needs nothing from them.

---

## Scopes requested, and why

| Scope | Used for |
|---|---|
| `read:graph:issue:jira`, `read:graph:project:jira`, `read:graph:issue-comment:jira` | Traverse from a work item to its space and context |
| `read:graph:page:confluence`, `read:graph:comment:confluence`, `read:graph:space:confluence` | Read the decision-bearing pages and their comment threads |
| `read:graph:user:atlassian`, `read:graph:team:atlassian` | Attribution of who decided |
| `read:graph:build:external`, `read:graph:deployment:external`, `read:graph:pull-request:external` | Outcome evidence, where a traversal exists |
| `read:confluence-content.all` | Reconstruct directly from a page's thread (REST v2) |
| `write:confluence-content` | Write the decision dossier page back to the space |
| `write:jira-work` | Read issues as the acting user; write the issue comment |

No write access to Teamwork Graph is requested — the API does not offer it.

---

## Verify an install

```bash
# app-scoped health check (no user session needed)
forge webtrigger create -f cascade-webhook -s <site>.atlassian.net -p Jira -e production
#  → open <url>?action=health
```

Expected: `{"ok":true,"surface":"webtrigger","runtime":"forge",...}`

Then in Jira: **Apps → Cascade** should render the case base with the decision
matrix. In Confluence: any page shows **Cascade decisions** under the title.
