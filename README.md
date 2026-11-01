# OAuth Runway

**How long until your users can connect this app?** OAuth Runway gives developers building AI agents setup and approval guides for provider OAuth apps. You can look up a provider in the library, or submit any app name or website and watch an agent investigate it and write a shareable guide in real time.

- Live demo: https://oauthguide-psi.vercel.app. If a passcode is configured for live generation, it is in the submission notes.
- Code: `web/` (Next.js 15 on Vercel). Live generation runs on Gemini's free tier, with Claude available as a drop-in provider.
- Evidence: `verification/` (live probe logs and the drafts from before verification)

## What I learned, and the scope I chose

A provider **OAuth app** is the client ID and secret, consent-screen branding, and approved scopes that a developer registers with a provider. The developer's **integration** (a Composio auth config, for example) uses that app. Each end user's **connection** is one authorization of that app. Composio's managed OAuth apps let developers skip registering an app while they prototype. For production they usually need their own app: their brand on the consent screen, scopes they choose, their own quotas, and an approval that belongs to them, because verification belongs to a specific client.

The research showed that **creating the app is rarely the hard part.** It takes under an hour almost everywhere. The difficulty, and the uncertainty the brief describes, sits in the climb from "works for me" to "any customer can connect":

- **Test-user caps and warnings:** Google allows 100 test users and expires refresh tokens after 7 days while an app is in Testing.
- **Install caps on unlisted apps:** HubSpot allows 25 installs.
- **Throttling for unlisted apps:** Slack limits `conversations.history` to 1 request per minute for unlisted commercial apps.
- **Scope tiers that trigger audits:** every Gmail read scope is restricted and needs an annual CASA assessment.
- **Admin consent:** Microsoft's default policy for new tenants blocks users from consenting to Mail.Read themselves.
- **Partner-gated access:** LinkedIn limits reading member posts to approved partners.

So the product focuses on **predicting that climb and splitting the work.** Every guide leads with a verdict: difficulty, hands-on time, calendar time, approval type, and the single blocker most likely to slow you down. After that come:
- The ladder from test app to production.
- A step checklist where each step is tagged "agent can do", "you do" or "wait".
- Scope tiers and what each one triggers.
- What to prepare for review and the common rejection reasons.
- Blockers, with the symptom you'll see and the fix.
- A "how much to trust this" panel.

## Key decisions

- **One fixed guide schema** (`web/src/lib/schema.ts`). Curated and live-generated guides share it, so they are comparable, can be exported as Markdown or JSON, and can be read by agents. A future library of 100 guides is a batch job over the same pipeline.
- **Evidence labels on every claim**:
  - *tested*: a live probe or hands-on attempt confirmed it.
  - *sourced*: a cited document says it.
  - *inferred*: reasoned, not confirmed.

  The synthesis step isn't allowed to raise a claim's label above what its research supports.
- **Agents test, not just read.** The live agent has a narrow `http_probe` tool: HTTPS GET to public hosts only, no redirects followed, and a capped response size. It fetches discovery documents and hits authorize endpoints with a dummy client, which confirms endpoints, PKCE support and how the provider rejects unknown clients.
- **Live generation on a free model, built around its limits.** The demo uses Gemini's free tier. Free-tier search grounding is unavailable, latency is unpredictable, and rate limits are tight, so the agent is a short pipeline instead of an open-ended tool loop:
  1. **Plan.** A Gemini Flash model names the product, its developer-docs host, the official pages likely to answer the key questions, and the endpoints to probe.
  2. **Read and follow links.** Code fetches those pages and drops any that don't exist, so made-up URLs are never cited. It collects on-topic links from the pages it read, and the model picks which to read over up to two rounds. Pages that only render with JavaScript go through Gemini's URL reader, keeping only URLs it actually retrieved. Keyless DuckDuckGo search is tried as well, but it's often bot-blocked, so nothing depends on it.
  3. **Probe.** `http_probe` hits the provider's discovery documents and authorize endpoint.
  4. **Write.** A schema-constrained call produces the guide. Code then enforces the evidence rules: "tested" requires a probe citation, and "sourced" requires a resolvable source.
  5. **Verify.** Right after the guide is saved, `web/src/lib/verify.ts` re-fetches every cited source (a 404 downgrades the claims that depended on it; a timeout or bot-block changes nothing), re-probes the authorize, token and discovery endpoints, applies consistency rules (label vs difficulty, approval vs calendar time, step coverage, citations resolve, "tested" means probed), cross-checks Composio's catalog for the managed-app flag and scopes, and smoke-tests the exports. Then a second model that did not write the guide re-checks its five to seven highest-impact claims against freshly fetched page text and either confirms, corrects or marks them unverified. Every check, every edit the verifier applied, and every re-checked claim with its supporting quote is published on the guide. Curated guides get the deterministic checks too (`npm run backfill-checks`), and any guide can be re-checked from its page.

  Each model call walks a fallback chain of models with timeouts. A typical run takes 60–180 seconds including the verification pass, and progress streams to the browser over SSE: pages read, probes, the agent's notes, then every check and claim verdict. The full research notes (page excerpts and probe responses) are stored with each guide so anyone can audit it. Setting `ANTHROPIC_API_KEY` switches to a Claude agent (`web/src/lib/agent.ts`) that uses built-in web search and fetch in a real tool loop.
- **The method page is computed, not written.** `/method` reads the live library on every request: guide counts, directory coverage, the evidence mix across every verdict, step, blocker and review section, the agent/you/wait split, and the verification table for each curated guide that carries a verification record. Adding a curated guide to `web/src/data/guides/` or generating one live updates the page with no edits.
- **Independent verification for the curated library.** Research agents drafted 8 guides. Separate agents that didn't write the drafts then re-checked 64 high-impact claims and corrected 9. Every correction is published per guide and on `/method`. Live-generated guides get the automated version of this (step 5 above), so no guide ships unchecked.
- **One trust status for every guide.** `web/src/lib/trust.ts` applies the same four rules to curated and generated guides alike: the automated checks ran, none failed, a second pass re-checked the key claims, and at least two claims were settled (confirmed, or corrected in place against a quoted source) with more settled than left unverified. All four met is **Verified** (green), checks ran but a rule is unmet is **Checked**, otherwise **Unchecked**. The badge, the rule-by-rule panel on each guide, and the status column on `/method` all come from that one function, so "curated" is only where a guide is stored, never a trust level. A verified generated guide is promoted into the curated set with `npm run promote -- <slug>`: the script fetches it from the live site, validates the schema, applies the same rules (refusing otherwise unless `--force`, which is recorded on the guide), writes it to `web/src/data/guides/` and re-indexes. The commit is the audit trail.
- **Variety over volume.** The 8 curated providers cover the whole range: GitHub and Notion (Easy), HubSpot, QuickBooks and Outlook (Moderate, each for a different reason), Gmail and Slack (Hard), and LinkedIn (Gated).
- **The library is the whole managed OAuth catalog.** The home page lists every OAuth-capable toolkit in Composio's [managed OAuth app directory](https://docs.composio.dev/toolkits/managed-auth): 387 apps, 125 of them with a Composio-managed OAuth app. The directory is built by `web/scripts/fetch-directory.mjs` from the same data file the docs page loads (`web/src/data/directory.json`, dated). Each app shows its logo and whether Composio manages an OAuth app for it. Apps with a guide open it; any other app starts the live agent. The directory also feeds the agent: when a requested app is in the catalog, the agent gets its canonical name, description, managed status, and the scopes Composio's own app requests, which is a strong hint of what an agent integration needs.
- **Logos.** Guides and the directory use the catalog's logo for listed apps. For apps outside the catalog, the generated guide falls back to the site's favicon. Logos are served from the catalog's CDN with a letter fallback if one fails to load.

## What was tested, sourced, and left uncertain

- **Tested.** Live endpoint probes, with no credentials, of all 8 providers on 2026-11-01. The probe script is `verification/probe.sh` and the output is `verification/probes-2026-11-01.txt`. Probe-confirmed facts are cited as "Live probe" sources.
- **Verified against sources.** 64 claims: 50 confirmed, 9 corrected, 5 unverified. Notable corrections:
  - LinkedIn changed from Easy to **Gated**: reading member posts is limited to "approved users only".
  - Google's 100-user cap for unverified apps is not a "lifetime" cap.
  - The 4–6 weeks for Gmail turned out to be a CASA tier estimate, not the restricted-scope review time.
  - Microsoft's consent block is the default only for new tenants.
  - HubSpot's legacy-app cutoff dates weren't conflicting; they depend on account age.

  Compare `verification/drafts-before/` with `web/src/data/guides/` to see every change.
- **Not tested.** No one logged into a provider console, created an app, or went through a review. Menu paths come from documentation. Review durations are provider estimates or community reports. Each guide lists its open questions under "Not verified / may vary".

## Run locally

```bash
cd web
cp .env.example .env.local      # add GEMINI_API_KEY (free at aistudio.google.com/apikey) or ANTHROPIC_API_KEY
npm install
npm run dev                     # http://localhost:3000
npm run validate-guides         # check the curated JSON against the schema
node scripts/fetch-directory.mjs  # refresh the app directory from Composio's catalog
```

**Deploying.** Every push to `main` runs `.github/workflows/deploy.yml`: lint, type check and guide-schema validation, then a production deploy to Vercel with the Vercel CLI. The workflow needs one repository secret, `VERCEL_TOKEN`; the project and team IDs are in the workflow file. Without the secret the checks still run and the deploy step is skipped with a warning.

Locally, generated guides are saved to `web/.data/`. On Vercel, connect a Blob store, which sets `BLOB_READ_WRITE_TOKEN`, so generated guides persist and can be shared. To add a curated guide, put its JSON in `web/src/data/guides/` and run `npm run index-guides`. The build also runs it.

## Limitations

- Live generation runs on Gemini's free tier: a small model, per-minute and per-day quotas, and latency that varies with load. A burst of requests can exhaust the quota. The page then shows the error and a retry. Research depth is lower than a frontier model with real web search would give (the Claude provider). Text read through Gemini's URL reader is a model extraction, not verbatim page text, and the research notes label it as such.
- Each generation runs inside one Vercel function (`maxDuration` 300 s). A production version would run the agent as a background job and let the page reconnect.
- Generated guides aren't reviewed by a human, and the page says so.
- Probes can confirm endpoints and error behavior, but not timelines or consent-screen details. Testing those properly needs a browser agent with a developer's console session, which is a natural next step.
- There's no rate limiting beyond the optional passcode.
- Provider policies change. Guides are dated and every claim links to its source.
