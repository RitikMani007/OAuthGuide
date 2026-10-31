# OAuth Runway

**How long until your users can connect this app?** OAuth Runway gives developers building AI agents setup and approval guides for provider OAuth apps. You can look up a provider in the library, or submit any app name or website and watch an agent investigate it and write a shareable guide in real time.

- Live demo: _<Vercel URL>_. Live generation asks for a passcode, which is in the submission notes.
- Code: `web/` (Next.js 15 on Vercel, Anthropic API)
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
- **Two phases for live generation.** Phase 1 is research with Claude Opus 5.5, using web search, web fetch and `http_probe`. Phase 2 is a structured-output call that turns the research notes into a guide matching the schema. Progress streams to the browser over SSE: searches, pages read, probes, and the agent's notes. The raw research notes are stored with the guide so anyone can audit it.
- **Independent verification for the curated library.** Research agents drafted 8 guides. Separate agents that didn't write the drafts then re-checked 64 high-impact claims and corrected 9. Every correction is published per guide and on `/method`.
- **Variety over volume.** The 8 curated providers cover the whole range: GitHub and Notion (Easy), HubSpot, QuickBooks and Outlook (Moderate, each for a different reason), Gmail and Slack (Hard), and LinkedIn (Gated).

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
cp .env.example .env.local      # add ANTHROPIC_API_KEY; DEMO_PASSCODE is optional
npm install
npm run dev                     # http://localhost:3000
npm run validate-guides         # check the curated JSON against the schema
```

Locally, generated guides are saved to `web/.data/`. On Vercel, connect a Blob store, which sets `BLOB_READ_WRITE_TOKEN`, so generated guides persist and can be shared. To add a curated guide, put its JSON in `web/src/data/guides/` and run `npm run index-guides`. The build also runs it.

## Limitations

- Live generation takes about 2–4 minutes and runs inside one Vercel function (`maxDuration` 300 s). A slow provider or a long research loop can hit the limit, and the page then shows a retry. A production version would run the agent as a background job and let the page reconnect.
- Generated guides aren't reviewed by a human, and the page says so.
- Probes can confirm endpoints and error behavior, but not timelines or consent-screen details. Testing those properly needs a browser agent with a developer's console session, which is a natural next step.
- There's no rate limiting beyond the optional passcode.
- Provider policies change. Guides are dated and every claim links to its source.
