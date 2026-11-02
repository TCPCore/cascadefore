# What I need from you

Five items. Each has a **where**, a **why**, and a **how to confirm**.
Everything not on this list is unblocked and continuing in the sandbox.

Quick answer format at the bottom — one line each.

---

## 1. Enable MCP tools on the app 🔴 highest value

**Where:** <https://admin.atlassian.com/s/e264c23b-67d7-48c5-ba33-9ef74f000ab6/user-connected-apps/EU6rjeUYpsjzWx0jOOm4PhvDNkpjl9Ng/details> → **Details** tab → bottom → *"Expose tools to MCP-compatible apps"* → **Enable tools**

**Why:** a tool call runs *inside* the app with the 15 Teamwork Graph scopes already granted. It is the only way to exercise live Teamwork Graph, the persisted Cypher and the attribution join without the Jira Apps panel — which is still unproven.

**Confirm with:** `MCP enabled`

**Then I will:** call `https://mcp.atlassian.com/forge/1fcb1899-1194-47c1-a794-26e4d3e59e0f` from a client, run the reconstruction against `CX-11`, and correct `queries.ts` against real relationship names. This closes `DAC-041`/`DAC-042` and the "no live graph call" gap.

---

## 2. Open the Apps panel on a work item 🔴

**Where:** <https://one-atlas-xoan.atlassian.net/browse/CX-11> → right sidebar → **Apps** (collapsed by default) → expand **Cascade**

**Why:** tells me whether the module mounts at all once found. Right now `forge logs` shows zero invocations, so I cannot distinguish "hidden behind a click" (expected) from "not registered" (a real problem).

**Confirm with one of:**
- `panel opens` — module is fine, I move on
- `no cascade in apps` — registration problem, I reinstall
- `panel blank` — send the first red line from DevTools console (⌥⌘I)

---

## 3. May I deploy to the **development** environment on the demo tenant?

**Where:** just a yes/no.

**Why:** you said no production pushes, which I'm holding to. But without `forge deploy -e development` I cannot test modules, scopes or Forge SQL at all — those only exist inside the Forge runtime. Development is a separate environment with its own 128 MiB database, separate variables, and no effect on production.

**Confirm with:** `dev ok` or `keep everything local`

---

## 4. App name for the listing

**Where:** just a decision.

The Forge app is registered as **Cascade**. The product is now **Decision as Code**, and the Marketplace listing name is independent of the registered app name.

**Options:**
- `Decision as Code` — matches the pitch, longer
- `Cascade` — shorter, already registered
- something else

**Confirm with:** the name.

---

## 5. Marketplace listing: publish the Developer Space?

**Where:** Developer Console → your space → **Settings** → *Make public on Marketplace*

**Why:** the "Best Marketplace published app" bonus needs a listing link **or** a review ticket. Publishing creates your public vendor profile.

⚠️ **This is irreversible** — a published Developer Space cannot be unpublished. It also needs a billing account with consent.

**Confirm with:** `publish` or `skip marketplace` (we can still file a listing ticket later, or drop that bonus category).

---

## Not needed from you (I'm handling it)

- Everything in the sandbox: runner, case base, mirror, attribution, ledger, UI, docs.
- Video script and submission pack — already written.
- Recording the video — needs you eventually, but not yet.
- The demo tenant's seeded demo projects — cosmetic, ignore.

---

## Reply format

Paste this and edit:

```
1. MCP:            enabled | can't find it
2. Panel:          opens | no cascade in apps | blank
3. Dev deploy:     dev ok | keep local
4. Name:           Decision as Code | Cascade | other
5. Marketplace:    publish | skip
```

Anything you leave blank, I'll assume "keep waiting" and continue in the sandbox.
