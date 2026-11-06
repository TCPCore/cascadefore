# Marketplace listing pack

Everything needed to publish an **Unlisted** listing and get a judge-installable
link. Unlisted is permitted for hackathon entries and still produces an install
link; Public is optional.

---

## Fields

**App name**
Cascade — Decision Index

**Tagline** (max ~70 chars)
Reconstruct decisions, see what was rejected, and know what was knowable then.

**Categories**
Developer tools · Project management

**Support / documentation**
https://github.com/TCPCore/cascadefore

**Privacy policy**
No customer content leaves the Atlassian platform. Decisions, outcomes and run
records are stored in Forge SQL inside the installation; the app makes no outbound
network calls other than to Atlassian APIs as the acting user. See
[PRIVACY.md](PRIVACY.md).

---

## Description (paste as-is)

Cascade turns the decisions a team already wrote down into an index you can
question.

Every organisation has decisions buried in Confluence threads and Jira history:
which datastore, which rollout, which exception. Cascade reconstructs those
decisions — what was chosen, what was considered and rejected, and why — and
records them as testable artefacts with a lifecycle: **enforced**, **violated**,
or **orphaned** (nobody can check it).

Three things make it different from a search box:

1. **It reconstructs from prose.** A comment thread becomes one decision with its
   positions and the resolution that was actually taken. No template required.
2. **It applies a time gate.** Evidence that did not exist when the decision was
   made is never used to judge it. Every alternative is shown against precedent
   that was *knowable then* versus what was learned *afterwards* — so a
   counterfactual is a comparison of equal-information decisions, not hindsight.
3. **It reports what it cannot check.** The orphan rate is a headline number, not
   something hidden.

Inside Jira you get a case base, a reconstruction of the decisions behind a work
item, a projected tree at any date you choose, and the paths that were not taken.
The same facts are exposed as MCP tools and Rovo actions, so an agent can answer
"why is this like this?" with citations.

### What it does not claim

- It does not predict outcomes, and it will not tell you a path was "better".
- It cannot read repository contents: Bitbucket workspace scopes cannot coexist
  with Jira/Confluence site scopes in one app, so repository content is out of
  scope by platform constraint.
- Teamwork Graph is read-only; the decision index lives in Forge SQL, and the
  graph supplies context.

---

## Screenshots (in this order)

| # | File | Caption |
|---|---|---|
| 1 | `docs/screenshots/01-case-base.png` | The decision matrix: 6 decisions across 7 areas, with the orphan rate reported |
| 2 | `docs/screenshots/02-paths-not-taken.png` | Paths not taken, with the reason each was rejected and precedent split by the time gate |
| 3 | `docs/screenshots/03-decision-tree.png` | Reconstruction: one decision, three positions, the resolution taken |
| 4 | `docs/screenshots/04-projected-tree.png` | The tree projected at a chosen date |
| 5 | `docs/screenshots/05-projected-before.png` | Anchored before the decision: nothing had been made yet |

Regenerate any of them with:

```bash
CASCADE_SOURCE=live CASCADE_STORE=sqlite PORT=4199 npx tsx scripts/serve.ts &
node scripts/shoot.mjs          # writes artifacts/shots/*.png
```

---

## Scopes justification (required field)

See the table in [INSTALL.md](INSTALL.md#scopes-requested-and-why). Summary:

> Read-only Teamwork Graph object scopes for issues, spaces, pages and comments;
> Confluence content read for reconstructing a page thread; Confluence content
> write for the decision dossier; Jira work for reading issues as the user and
> adding an explanatory comment. No write access to Teamwork Graph is requested
> because the API does not provide it.

---

## Publishing steps

1. https://developer.atlassian.com/console/myapps/ → select the app
2. **Distribution** → choose **Unlisted**
3. Paste the fields above, upload the five screenshots
4. Submit for review — a review ticket alone satisfies the Codegeist bonus
   category "Best Marketplace published app"
5. Copy the install link from the listing and put it in the Devpost submission

⚠️ Making a Developer Space public is irreversible; **Unlisted** is enough.
