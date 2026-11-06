# Do this — the three remaining owner actions

Everything technical is done and verified. These three need your browser.

---

## 1. Watch, then upload the demo video (15 minutes)

File: `artifacts/video/demo.webm` — ~100 seconds, 1080p, captioned.
Recorded from the running product with `node scripts/record-demo.mjs`.

Beats: ask the index → decision matrix → paths not taken (with time-gated
precedent) → reconstruction → the tree projected at two anchors → forensic
timeline.

**Check before uploading:** captions legible, no dead air, nothing private on
screen.

**Upload:** <https://studio.youtube.com> → Create → Upload videos

- Title: `Decision as Code — Cascade`
- Visibility: **Public** (Devpost needs a public video; unlisted is usually rejected)
- Not made for kids

Send me the URL and I will put it in the submission text.

---

## 2. Create the Unlisted Marketplace listing (30 minutes)

This does two things: it produces the **judge install link**, and it claims the
$1,500 *Best Marketplace published app* bonus.

1. <https://developer.atlassian.com/console/myapps/> → select the app
2. **Distribution** → **Unlisted**
3. Copy every field from [MARKETPLACE_LISTING.md](MARKETPLACE_LISTING.md)
4. Upload the five screenshots from `docs/screenshots/`
5. Submit for review — **a review ticket alone satisfies the bonus category**
6. Copy the **install link** from the listing and send it to me

⚠️ Making a Developer Space public is irreversible. **Unlisted is enough.**

---

## 3. Submit on Devpost (30 minutes)

<https://codegeist2026.devpost.com> → Submit project.

| Field | Value |
|---|---|
| Name | `Decision as Code` |
| Tagline | Every architecture decision becomes a testable artefact with a lifecycle |
| Track | **Apps for Software Teams** |
| Bonus | Best Agents · Best app with Atlassian MCP · Best apps with Teamwork Graph integration · Best Marketplace published app |
| Repo | `https://github.com/TCPCore/cascadefore` |
| Video | the YouTube URL from step 1 |
| Install link | from step 2 (or point judges at the sandbox) |

**Evaluation instructions to paste into the form:**

> Fastest path (no Atlassian account required):
> `git clone https://github.com/TCPCore/cascadefore && npm install && npm --prefix static/panel install`
> `CASCADE_SOURCE=live CASCADE_STORE=sqlite npx tsx scripts/serve.ts` → http://localhost:4173
>
> Built with: Forge (Jira + Confluence), Teamwork Graph persisted Cypher,
> Rovo agent/skill/MCP, Forge SQL.

Deadline: **22 December 2026, 12:00 PM PT**. Submit at least a day early.

---

## Optional, if you want the last bonus claimable

**Invoke the Rovo agent once.** Open Rovo in your Atlassian site, look for
**Cascade**, and ask *"why does the billing service use Postgres?"*. If it answers
with the decision and its rationale, send me a screenshot — that converts
"declared" into "verified" for the Best Agents category.

---

## What is already done (no action needed)

- 261 tests, root + panel typecheck, lint clean, both panel bundles build
- Deployed to development and production; both installs Up-to-date
- Live probes: `?action=search`, `?action=why`, `?action=matrix`,
  `?action=precedent`, `?action=project`, `?action=replay` all return real data
- MCP verified end to end (8 tools)
- Screenshots of every view at 1440px and 390px
- Docs: INSTALL, MARKETPLACE_LISTING, SCORECARD, SUBMISSION, GRAPH-BOUNDARY
