# Do this — the five steps only you can do

Ordered by value per minute. Steps 1–2 are five minutes total and decide the
submission's shape; step 3 is the video; steps 4–5 are submission and listing.

Values you'll need:

```
site        https://one-atlas-xoan.atlassian.net
repo        https://github.com/TCPCore/cascadefore
app id      1fcb1899-1194-47c1-a794-26e4d3e59e0f
mcp url     https://mcp.atlassian.com/forge/1fcb1899-1194-47c1-a794-26e4d3e59e0f
source page https://one-atlas-xoan.atlassian.net/wiki/spaces/MD/pages/2129941
```

---

> **Development is current: 2.16.0**, deployed 2026-11-03, both Jira and
> Confluence installs `Up-to-date`. Production is still 2.3.0 and deliberately
> untouched. The sandbox (`localhost:4173`) runs the same engine.

## Step 1 — Panel check (3 minutes) ← the only unknown left

**Pick an issue that already has history.** Do **not** use `CX-11`; it was created
an hour before the graph indexed it and has no comments, so it will render empty
and you won't be able to tell an empty state from a failure.

Good candidates, all real, all with content:

```
https://one-atlas-xoan.atlassian.net/browse/LEO-47
https://one-atlas-xoan.atlassian.net/browse/SALES-27
https://one-atlas-xoan.atlassian.net/browse/MC-43
https://one-atlas-xoan.atlassian.net/browse/MOBL-2
```

### Do this

1. Open one of the URLs above.
2. In the **right-hand sidebar**, find **Apps** (it is collapsed by default in the
   2026 work-item view).
3. Click **Apps** → click **Cascade** to expand it.
4. Open DevTools: **⌥⌘I** → **Network** tab → in the filter box type `invoke`.
5. Click **Run Cascade** in the panel if a button is visible. If no button is
   visible, just note what you see.
6. Look at the requests that appear. Note the **status code** next to the request
   named `invoke` or `startCascade`.

### Report these two numbers

```
Mount:    panel visible | no Cascade in Apps | panel blank
Resolver: 200 | 401 | no request at all
```

Plus one screenshot of the panel area if it rendered anything at all.

### What each answer means

| Result | Meaning | What I do next |
|---|---|---|
| visible + 200 | both gates pass | flip demo mode off, run the real reconstruction, add the panel shot to the video |
| visible + 401 | panel mounts, no user session in the resolver | record the platform limit; pitch becomes MCP + Rovo + SQL, panel deferred |
| visible, blank | bundle/iframe problem | fix the resource or the runtime error |
| no Cascade in Apps | module not registered | reinstall the dev build, retry once |
| no request at all | the module never loaded | same as above |

---

## Step 2 — Refresh the MCP token (optional, 1 minute)

Only if you want me to run more live MCP checks. The token expires; the consent
does not have to be redone.

```bash
npx -y mcp-remote https://mcp.atlassian.com/forge/1fcb1899-1194-47c1-a794-26e4d3e59e0f
```

Leave it running for ~20 seconds, approve if a browser tab opens, then close it.
Tell me `token refreshed`.

---

## Step 3 — Record the video (60–90 minutes)

The script is shot-by-shot in [DEMO_SCRIPT.md](DEMO_SCRIPT.md). Read it once
before recording; the beats are timed.

### 3a. Prepare (10 minutes)

Open three things in this order so nothing loads on camera:

```bash
# Terminal 1 — the sandbox on real recorded data
cd /Users/tom/Documents/CASCADE
CASCADE_SOURCE=live CASCADE_STORE=sqlite CASCADE_DB=/tmp/demo.db npx tsx scripts/serve.ts
# → http://127.0.0.1:4173
```

```bash
# Terminal 2 (separate window, large font) — prove the build fails
cd /Users/tom/Documents/CASCADE
npx tsx scripts/run-decisions.ts --dir examples/decision-repo/.decisions --root examples/decision-repo
# → exit 1, one violated, one orphaned
```

Browser tabs, in this order:

1. `http://127.0.0.1:4173`
2. `https://one-atlas-xoan.atlassian.net/wiki/spaces/MD/pages/2129941`
3. `examples/decision-repo/.decisions/0031-datastore-monitoring.decision` in your editor

Run the case base once so the cache is warm, then reload so it's fresh.

### 3b. Record (20 minutes, expect 2–3 takes)

macOS built-in:

1. **⌘⇧5**
2. Choose **Record Entire Screen** (or **Record Selected Portion** if you want it
   tighter).
3. Click **Options** → **Microphone** → choose your mic if narrating.
4. Click **Record**. A stop button appears in the menu bar.
5. Follow the beats in DEMO_SCRIPT.md. Target **2:30**; hard ceiling 3:00.
6. **⌘⌃Esc** or the menu-bar stop button to finish.

Save to the Desktop.

### 3c. Review before uploading

Watch it once and check:

- [ ] the Confluence comments are legible (Beat 3)
- [ ] the taken branch reads "Yes, for now…" (Beat 4)
- [ ] `evidenceSource: real_confluence_thread` is visible (Beat 5)
- [ ] nothing shows a password, token, or email you don't want public
- [ ] under 5 minutes

### 3d. Upload (10 minutes)

1. <https://studio.youtube.com> → **Create** → **Upload videos**
2. Title: `Decision as Code — Codegeist 2026`
3. Visibility: **Public** (not Unlisted — Devpost rules require a public video;
   double-check the rules page wording)
4. Not made for kids → Next through the checks
5. Copy the URL: `https://youtu.be/…`

Tell me the URL and I'll fold it into the submission text.

---

## Step 4 — Submit on Devpost (30 minutes)

1. <https://codegeist2026.devpost.com> → **Submit project** (or join the hackathon
   first if you haven't).
2. Fill from [SUBMISSION.md](SUBMISSION.md). The fields that matter:

| Field | Value |
|---|---|
| Project name | `Decision as Code` |
| Tagline | Every architecture decision becomes a testable artefact with a lifecycle |
| Track | **Apps for Software Teams** |
| Bonus prizes | check **Best Agents**, **Best app with Atlassian MCP**, **Best apps with Teamwork Graph integration**, **Best Marketplace published app** |
| Repo | `https://github.com/TCPCore/cascadefore` |
| Video | the YouTube URL from step 3 |
| Built with | Forge, Teamwork Graph, Rovo, MCP, TypeScript, React |

3. The "how the technical requirement is met" box — paste this:

> Built on Forge. Integrates Teamwork Graph (`read:graph:*` object scopes,
> persisted Cypher), Rovo (`rovo:agent`, `rovo:skill`, `rovo:mcp`) and Jira +
> Confluence surfaces. Verified over MCP: `reconstruct-decision`, `get-run`,
> `health` execute in the Forge runtime and persist to Forge SQL.

4. Add the **install link** if asked. If the app isn't shareable yet, say the
   sandbox is the evaluation path:

> `npm install && CASCADE_SOURCE=live npx tsx scripts/serve.ts` → localhost:4173

5. Save. **Do not submit on the last day** — submit at least 24 hours early so a
   broken field can be fixed.

---

## Step 5 — Marketplace listing (optional, irreversible)

⚠️ **Publishing a Developer Space cannot be undone**, and it needs a billing
account with consent. Do this only if you want the fourth bonus category, and
only after step 4 is submitted.

1. <https://developer.atlassian.com/console/myapps/>
2. Your space → **Settings**
3. *Make public on Marketplace* → **Review & publish** → accept the Partner
   Agreement

Then file a listing for the app. **A review ticket alone satisfies the bonus** —
you do not need approval.

If you'd rather not: skip it and uncheck that bonus category in step 4. The other
three stand on their own.

---

## What I need back, in one message

```
1. Mount:    panel visible | no Cascade in Apps | panel blank
2. Resolver: 200 | 401 | no request
3. Video:    <youtube url>   (or "not yet")
```

With those I'll update the submission text to match reality and, if the panel
works, add the screen to the video plan.
