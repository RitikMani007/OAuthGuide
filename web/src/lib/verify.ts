import "server-only";
import { z } from "zod";
import { toJSONSchema } from "zod";
import type { StoredGuide, CheckResult, CheckStatus, AutoChecks } from "./schema";
import { httpProbe, checkPublicHttps } from "./probe";
import { readPage } from "./web";
import { findToolkit } from "./directory";
import { guideToMarkdown } from "./export";
import { gemini, FAST_MODELS, WRITER_MODELS } from "./gemini";

// Post-generation verification. Runs right after a guide is saved (and on demand for
// existing guides). Two layers:
//  1. Deterministic checks that need no model: re-fetch every cited source, re-probe the
//     OAuth endpoints the guide names, apply consistency rules, cross-check Composio's
//     catalog, and smoke-test the exports. Failures downgrade evidence and add open
//     questions; they never block the guide.
//  2. An independent model re-check of the highest-impact claims against freshly fetched
//     page text, mirroring the process used for the curated library.

type Finding = NonNullable<StoredGuide["meta"]["verification"]>["findings"][number];

export type VerifyEvent =
  | { type: "check"; result: CheckResult }
  | { type: "claim"; finding: Finding }
  | { type: "note"; text: string };

export type VerifyOptions = { claims?: boolean; signal?: AbortSignal };

const LABEL_FOR: Record<number, StoredGuide["verdict"]["label"]> = { 1: "Instant", 2: "Easy", 3: "Moderate", 4: "Hard", 5: "Gated" };
const UA = "oauth-runway-verifier/1.0 (+automated source check)";

const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

export async function* verifyGuide(input: StoredGuide, opts: VerifyOptions = {}): AsyncGenerator<VerifyEvent, StoredGuide> {
  const started = Date.now();
  const g: StoredGuide = structuredClone(input);
  const results: CheckResult[] = [];
  const applied: string[] = [];
  // Notes from a previous automated run are regenerated below; drop them so re-runs do not pile up.
  g.uncertain = g.uncertain.filter((u) => !/^Automated (check|re-check)/.test(u));
  const emit = (r: Omit<CheckResult, "id">): VerifyEvent => {
    const result = { id: `${r.group}-${results.filter((x) => x.group === r.group).length + 1}`, ...r };
    results.push(result);
    return { type: "check", result };
  };

  // ---- 1. Links: can every cited source still be fetched? ------------------------------
  const linkSources = g.sources.filter((s) => s.kind !== "tested");
  const dead = new Set<string>();
  const unreachable = new Set<string>();
  const statuses = await mapLimit(linkSources, 6, async (s) => ({ s, ...(await linkStatus(s.url)) }));
  for (const { s, status, error } of statuses) {
    if (error === "not https" || error === "private host") {
      dead.add(s.id);
      yield emit({ group: "links", label: s.title, url: s.url, status: "fail", detail: `Rejected: ${error}.` });
    } else if (status && status >= 200 && status < 400) {
      yield emit({ group: "links", label: s.title, url: s.url, status: "pass", detail: `Reachable (HTTP ${status}).` });
    } else if (status === 404 || status === 410) {
      dead.add(s.id);
      yield emit({ group: "links", label: s.title, url: s.url, status: "fail", detail: `Gone (HTTP ${status}). Claims that rely only on this source were downgraded to inferred.` });
    } else if (status && [401, 403, 429, 999].includes(status)) {
      unreachable.add(s.id);
      yield emit({ group: "links", label: s.title, url: s.url, status: "warn", detail: `HTTP ${status}: the site blocks automated readers, so the page exists but its text could not be re-read.` });
    } else if (status && status >= 500) {
      unreachable.add(s.id);
      yield emit({ group: "links", label: s.title, url: s.url, status: "warn", detail: `HTTP ${status}: server error while re-fetching; treated as temporary.` });
    } else {
      // Timeouts, DNS hiccups and resets are transient: never downgrade evidence on them.
      unreachable.add(s.id);
      yield emit({ group: "links", label: s.title, url: s.url, status: "warn", detail: `Could not fetch (${error ?? "no response"}); treated as temporary, so nothing was downgraded. Re-run the checks later.` });
    }
  }
  if (!linkSources.length) yield emit({ group: "links", label: "Cited sources", status: "skip", detail: "The guide cites no documentation sources." });
  if (dead.size) {
    let downgraded = 0;
    g.steps = g.steps.map((st) => {
      const live = st.source_ids.filter((id) => !dead.has(id) && g.sources.some((s) => s.id === id));
      if (st.evidence !== "inferred" && st.source_ids.length && !live.length) {
        downgraded++;
        return { ...st, evidence: "inferred" as const };
      }
      return st;
    });
    const titles = [...dead].map((id) => g.sources.find((s) => s.id === id)?.title ?? id);
    const note = `Automated check (${today()}): ${titles.length} cited source${titles.length > 1 ? "s" : ""} could not be fetched (${titles.slice(0, 3).join("; ")}${titles.length > 3 ? "…" : ""}). ${downgraded ? `${downgraded} step${downgraded > 1 ? "s were" : " was"} downgraded to inferred.` : "No step depended on them alone."}`;
    g.uncertain = [...g.uncertain, note];
    applied.push(downgraded ? `Downgraded ${downgraded} step(s) to inferred because their only sources were unreachable.` : "Logged unreachable sources as an open question.");
  }

  // ---- 2. Endpoints: do the OAuth URLs the guide names actually exist? -----------------
  const auth = g.oauth.authorize_url;
  const token = g.oauth.token_url;
  let discovery: Record<string, unknown> | null = null;
  if (auth && isPlaceholder(auth)) {
    yield emit({ group: "endpoints", label: "Authorize endpoint", url: auth, status: "skip", detail: "The URL contains a per-tenant placeholder, so there is no fixed host to probe." });
  } else if (auth && /^https:\/\//.test(auth)) {
    const probeUrl = withParams(auth, { client_id: "test_probe", response_type: "code", redirect_uri: "https://example.com/cb", scope: g.scopes[0]?.scope ?? "" });
    const r = await httpProbe(probeUrl);
    const cls = classifyAuthorize(r.status, r.location, r.body_excerpt);
    yield emit({ group: "endpoints", label: "Authorize endpoint", url: auth, status: r.error ? "warn" : r.status === 404 ? "fail" : "pass", detail: r.error ? `No response (${r.error}); treated as temporary.` : `HTTP ${r.status}: ${cls}` });

    // PKCE acceptance (does not prove enforcement, only that the parameters are not rejected outright)
    const pk = await httpProbe(withParams(probeUrl, { code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method: "S256" }));
    if (!pk.error && pk.status && pk.status !== 404) {
      const rejects = /code_challenge|pkce/i.test(pk.body_excerpt ?? "") && /unsupported|invalid|not supported|unknown/i.test(pk.body_excerpt ?? "");
      yield emit({ group: "endpoints", label: "PKCE parameters", url: auth, status: rejects ? "warn" : "pass", detail: rejects ? `The endpoint rejected code_challenge (HTTP ${pk.status}). Guide says PKCE: "${g.oauth.pkce}".` : `Request with code_challenge/S256 accepted at the transport level (HTTP ${pk.status}). This confirms the parameters are tolerated, not that PKCE is enforced.` });
    }

    // Discovery document, when the issuer publishes one
    try {
      const origin = new URL(auth).origin;
      for (const path of ["/.well-known/openid-configuration", "/.well-known/oauth-authorization-server"]) {
        const d = await httpProbe(origin + path);
        if (d.status === 200 && d.body_excerpt?.trim().startsWith("{")) {
          try {
            discovery = JSON.parse(d.body_excerpt) as Record<string, unknown>;
          } catch {
            /* excerpt was truncated; fall through */
          }
          if (discovery) {
            const ae = typeof discovery.authorization_endpoint === "string" ? discovery.authorization_endpoint : null;
            const same = ae ? normUrl(ae) === normUrl(auth) : null;
            if (same !== true) {
              // A discovery document for a different authorize URL usually describes a different flow
              // (e.g. OIDC sign-in next to the app-install flow); it must not be used to "correct" the guide.
              yield emit({ group: "endpoints", label: "Discovery document", url: origin + path, status: "warn", detail: ae ? `Publishes authorization_endpoint ${ae}, but the guide's authorize URL is ${auth}. It likely describes a different flow (such as OIDC sign-in), so it was not used to check PKCE or the token endpoint.` : "Found, but it names no authorization_endpoint, so it was not used for comparison." });
              discovery = null;
              break;
            }
            yield emit({ group: "endpoints", label: "Discovery document", url: origin + path, status: "pass", detail: "Found; the authorization endpoint matches the guide." });
            const methods = Array.isArray(discovery.code_challenge_methods_supported) ? (discovery.code_challenge_methods_supported as string[]) : null;
            if (methods) {
              const saysNo = /not supported|unsupported|unknown|no\b/i.test(g.oauth.pkce) && !/supported|required/i.test(g.oauth.pkce.replace(/not supported|unsupported/gi, ""));
              if (methods.length && saysNo) {
                applied.push(`Set PKCE to "supported (${methods.join(", ")}, per discovery document)"; the guide said "${g.oauth.pkce}".`);
                g.oauth.pkce = `Supported (${methods.join(", ")}, per the provider's discovery document)`;
                yield emit({ group: "endpoints", label: "PKCE per discovery", status: "warn", detail: `Discovery lists ${methods.join(", ")}; the guide's PKCE statement was corrected.` });
              } else {
                yield emit({ group: "endpoints", label: "PKCE per discovery", status: "pass", detail: methods.length ? `Discovery lists ${methods.join(", ")}; consistent with the guide.` : "Discovery lists no PKCE methods." });
              }
            }
            const te = typeof discovery.token_endpoint === "string" ? discovery.token_endpoint : null;
            if (te && token && normUrl(te) !== normUrl(token)) yield emit({ group: "endpoints", label: "Token endpoint vs discovery", status: "warn", detail: `Discovery says ${te}; the guide says ${token}.` });
            break;
          }
        }
      }
    } catch {
      /* ignore */
    }
  } else {
    yield emit({ group: "endpoints", label: "Authorize endpoint", status: "skip", detail: "The guide does not name an authorize URL." });
  }
  if (token && isPlaceholder(token)) {
    yield emit({ group: "endpoints", label: "Token endpoint", url: token, status: "skip", detail: "The URL contains a per-tenant placeholder, so there is no fixed host to probe." });
  } else if (token && /^https:\/\//.test(token)) {
    // A dummy authorization-code exchange: a real token endpoint answers 4xx with an OAuth error body.
    const r = await httpProbe(token, { method: "POST", body: "grant_type=authorization_code&client_id=test_probe&client_secret=test_probe&code=test_probe&redirect_uri=https%3A%2F%2Fexample.com%2Fcb" });
    const oauthError = /invalid_(request|client|grant)|unsupported_grant_type|unauthorized_client|bad_verification_code/i.test(r.body_excerpt ?? "");
    if (r.error) yield emit({ group: "endpoints", label: "Token endpoint", url: token, status: "warn", detail: `No response (${r.error}); treated as temporary.` });
    else if (r.status === 404 && !oauthError) yield emit({ group: "endpoints", label: "Token endpoint", url: token, status: "warn", detail: "HTTP 404 to a dummy POST. Some providers (GitHub, for one) answer 404 for an unknown client, so this does not prove the URL is wrong; check it against the cited docs." });
    else yield emit({ group: "endpoints", label: "Token endpoint", url: token, status: "pass", detail: oauthError ? `Exists: a dummy code exchange was rejected with an OAuth error (HTTP ${r.status}).` : `Exists (HTTP ${r.status} to a dummy POST).` });
  }

  // ---- 3. Consistency rules ------------------------------------------------------------
  const wantLabel = LABEL_FOR[g.verdict.difficulty];
  if (wantLabel && g.verdict.label !== wantLabel) {
    applied.push(`Label "${g.verdict.label}" did not match difficulty ${g.verdict.difficulty}; set to "${wantLabel}".`);
    g.verdict.label = wantLabel;
    yield emit({ group: "consistency", label: "Difficulty label", status: "warn", detail: `Corrected the label to ${wantLabel} to match difficulty ${g.verdict.difficulty}/5.` });
  } else yield emit({ group: "consistency", label: "Difficulty label", status: "pass", detail: `${g.verdict.label} matches ${g.verdict.difficulty}/5.` });

  const longWait = /week|month|never/i.test(g.verdict.calendar);
  if (g.verdict.approval === "none" && longWait)
    yield emit({ group: "consistency", label: "Approval vs calendar time", status: "warn", detail: `Approval is "none" but calendar time is "${g.verdict.calendar}". Check the time note explains what the wait is.` });
  else if (g.verdict.approval !== "none" && /same day|minutes|hour/i.test(g.verdict.calendar) && !/–|-|to/.test(g.verdict.calendar))
    yield emit({ group: "consistency", label: "Approval vs calendar time", status: "warn", detail: `Approval "${g.verdict.approval}" usually implies a wait, but calendar time is "${g.verdict.calendar}".` });
  else yield emit({ group: "consistency", label: "Approval vs calendar time", status: "pass", detail: `"${g.verdict.calendar}" is consistent with approval "${g.verdict.approval}".` });

  yield emit({ group: "consistency", label: "Stage ladder", status: g.stages.length >= 2 ? "pass" : "warn", detail: `${g.stages.length} stage${g.stages.length === 1 ? "" : "s"} from test app to production.` });
  const phases = new Set(g.steps.map((s) => s.phase));
  const missing = ["register", "configure", "test"].filter((p) => !phases.has(p as never));
  yield emit({ group: "consistency", label: "Step coverage", status: missing.length ? "warn" : "pass", detail: missing.length ? `${g.steps.length} steps; no step for: ${missing.join(", ")}.` : `${g.steps.length} steps covering ${[...phases].join(" → ")}.` });
  const noHelp = g.steps.filter((s) => s.owner === "agent" && !s.agent_help).length;
  yield emit({ group: "consistency", label: "Agent steps explain the help", status: noHelp ? "warn" : "pass", detail: noHelp ? `${noHelp} agent-owned step${noHelp > 1 ? "s" : ""} lack an "agent can help" note.` : "Every agent-owned step says what the agent produces." });
  const ids = new Set(g.sources.map((s) => s.id));
  const dangling = g.steps.flatMap((s) => s.source_ids).filter((id) => !ids.has(id));
  if (dangling.length) {
    g.steps = g.steps.map((s) => ({ ...s, source_ids: s.source_ids.filter((id) => ids.has(id)) }));
    applied.push(`Removed ${dangling.length} dangling source reference(s).`);
  }
  yield emit({ group: "consistency", label: "Citations resolve", status: dangling.length ? "warn" : "pass", detail: dangling.length ? `${dangling.length} citation(s) pointed at missing sources and were removed.` : "Every citation points at a listed source." });
  const probeIds = new Set(g.sources.filter((s) => s.kind === "tested").map((s) => s.id));
  const overclaimed = g.steps.filter((s) => s.evidence === "tested" && !s.source_ids.some((id) => probeIds.has(id))).length;
  yield emit({ group: "consistency", label: "\"Tested\" means probed", status: overclaimed ? "fail" : "pass", detail: overclaimed ? `${overclaimed} step(s) marked tested without citing a probe.` : `${g.steps.filter((s) => s.evidence === "tested").length} tested step(s) all cite a live probe.` });
  yield emit({ group: "consistency", label: "Blockers", status: g.blockers.length >= 2 ? "pass" : "warn", detail: `${g.blockers.length} blocker${g.blockers.length === 1 ? "" : "s"} with symptom and fix.` });

  // ---- 4. Catalog cross-check (Composio managed OAuth directory) -----------------------
  const entry = findToolkit(g.name) ?? findToolkit(g.slug) ?? findToolkit(g.website);
  if (!entry) yield emit({ group: "catalog", label: "Composio catalog", status: "skip", detail: "Not in the managed OAuth catalog; nothing to compare." });
  else {
    if (g.managed_alternative.composio_managed !== entry.managed) {
      applied.push(`Set composio_managed to ${entry.managed} from the catalog (guide said ${String(g.managed_alternative.composio_managed)}).`);
      g.managed_alternative.composio_managed = entry.managed;
      yield emit({ group: "catalog", label: "Managed OAuth app", status: "warn", detail: `Catalog says ${entry.managed ? "Composio provides a managed app" : "bring your own app"}; corrected the guide.` });
    } else yield emit({ group: "catalog", label: "Managed OAuth app", status: "pass", detail: entry.managed ? "Catalog confirms a Composio-managed OAuth app exists." : "Catalog confirms you must bring your own OAuth app." });
    const defaults = entry.default_scopes.split(",").map((x) => x.trim()).filter(Boolean);
    if (defaults.length) {
      const have = g.scopes.map((s) => s.scope.toLowerCase());
      const miss = defaults.filter((d) => !have.some((h) => h.includes(d.toLowerCase()) || d.toLowerCase().includes(h)));
      const covered = defaults.length - miss.length;
      yield emit({ group: "catalog", label: "Scopes vs Composio's managed app", status: covered === 0 ? "warn" : "pass", detail: miss.length ? `${covered}/${defaults.length} of the scopes Composio's managed app requests appear in the guide (the guide lists the scopes a minimal integration needs, not every scope a full one may ask for). Not in the guide: ${miss.slice(0, 4).join(", ")}${miss.length > 4 ? "…" : ""}.` : `All ${defaults.length} scopes Composio's managed app requests are covered.` });
    }
  }

  // ---- 5. Usability / export smoke test ------------------------------------------------
  const short = g.steps.filter((s) => s.detail.trim().length < 60).length;
  yield emit({ group: "usability", label: "Step detail", status: short ? "warn" : "pass", detail: short ? `${short} step(s) have under 60 characters of instructions.` : "Every step has concrete instructions." });
  try {
    const mdText = guideToMarkdown(g, `https://example.invalid/guides/${g.slug}`);
    const json = JSON.stringify(g);
    yield emit({ group: "usability", label: "Exports render", status: mdText.length > 800 && json.length > 2000 ? "pass" : "warn", detail: `Markdown ${(mdText.length / 1000).toFixed(1)}k chars, JSON ${(json.length / 1000).toFixed(1)}k chars.` });
  } catch (e) {
    yield emit({ group: "usability", label: "Exports render", status: "fail", detail: `Export threw: ${e instanceof Error ? e.message : String(e)}` });
  }

  // ---- 6. Independent claim re-check (model) -------------------------------------------
  if (opts.claims) {
    yield { type: "note", text: "Re-checking the highest-impact claims against freshly fetched sources… " };
    try {
      const outcome = await recheckClaims(g, { dead, unreachable, discovery, signal: opts.signal });
      for (const f of outcome.findings) yield { type: "claim", finding: f };
      for (const a of outcome.applied) applied.push(a);
      g.meta.verification = { date: today(), kind: "automated", model: outcome.model, method: `Automated re-check of ${outcome.findings.length} high-impact claims by a model that did not write the guide, against ${outcome.pages} freshly fetched cited pages and ${outcome.probes} live probe results.`, findings: outcome.findings };
      const n = (r: Finding["result"]) => outcome.findings.filter((f) => f.result === r).length;
      yield emit({ group: "claims", label: "Claim re-check", status: n("corrected") ? "warn" : "pass", detail: `${n("confirmed")} confirmed, ${n("corrected")} corrected, ${n("unverified")} unverified (model: ${outcome.model}).` });
    } catch (e) {
      yield emit({ group: "claims", label: "Claim re-check", status: "skip", detail: `Skipped: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const summary: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const r of results) summary[r.status]++;
  const checks: AutoChecks = { date: today(), duration_ms: Date.now() - started, results, summary, applied };
  g.meta.checks = checks;
  return g;
}

// ---------------------------------------------------------------------------------------

const Findings = z.object({
  findings: z.array(
    z.object({
      claim: z.string(),
      result: z.enum(["confirmed", "corrected", "unverified"]),
      note: z.string().describe("one or two sentences: what the source says, or why it could not be checked"),
      quote: z.string().describe("the exact supporting sentence from the provided text, or empty"),
      corrected_value: z.string().describe("only when result is corrected: the corrected short statement (max 200 chars), else empty"),
    }),
  ),
});

type Claim = { key: string; field: string; text: string; apply?: (v: string) => void };

async function recheckClaims(g: StoredGuide, ctx: { dead: Set<string>; unreachable: Set<string>; discovery: Record<string, unknown> | null; signal?: AbortSignal }) {
  const claims: Claim[] = [
    { key: "c1", field: "verdict.headline_blocker", text: `The single most likely blocker is: ${g.verdict.headline_blocker}`, apply: (v) => (g.verdict.headline_blocker = v) },
    { key: "c2", field: "review.typical_duration", text: `Review/approval typically takes: ${g.review.typical_duration}`, apply: (v) => (g.review.typical_duration = v) },
    { key: "c3", field: "review.required_when", text: `Review is required when: ${g.review.required_when}` },
    { key: "c4", field: "oauth.pkce", text: `PKCE: ${g.oauth.pkce}`, apply: (v) => (g.oauth.pkce = v) },
    { key: "c5", field: "oauth.refresh_tokens", text: `Tokens and refresh: ${g.oauth.refresh_tokens}`, apply: (v) => (g.oauth.refresh_tokens = v) },
  ];
  const cap = g.stages.find((s) => /\d/.test(s.what_you_get));
  if (cap) claims.push({ key: "c6", field: "stages", text: `Stage "${cap.name}": ${cap.what_you_get}` });
  const restricted = g.scopes.filter((s) => s.tier === "restricted" || s.tier === "partner-only").slice(0, 3);
  if (restricted.length) claims.push({ key: "c7", field: "scopes", text: `These scopes are ${restricted[0].tier}: ${restricted.map((s) => `${s.scope} (${s.review_impact})`).join("; ")}` });

  // Fresh evidence: official sources that are still reachable, read now.
  const candidates = g.sources.filter((s) => s.kind !== "tested" && !ctx.dead.has(s.id) && !ctx.unreachable.has(s.id)).sort((a, b) => Number(b.kind === "official") - Number(a.kind === "official")).slice(0, 6);
  const pages = (await mapLimit(candidates, 4, async (s) => ({ s, p: await readPage(s.url, 6000) }))).filter((x) => !x.p.error || x.p.text.length > 500);
  if (!pages.length) throw new Error("none of the cited pages could be re-read");
  const probeText = ctx.discovery ? `DISCOVERY DOCUMENT (live probe): ${JSON.stringify(ctx.discovery).slice(0, 2500)}` : "";

  const res = await gemini({
    models: [...WRITER_MODELS, ...FAST_MODELS],
    system: `You are an independent fact-checker for a developer guide about registering an OAuth app with ${g.name}. You did not write the guide. For each claim decide, using ONLY the page text and probe results provided:
- "confirmed": the text clearly supports the claim (quote the sentence).
- "corrected": the text clearly contradicts a specific detail (give the corrected statement in corrected_value, short, in the same style as the claim's value, and quote the sentence).
- "unverified": the provided text does not settle it.
Never use outside knowledge. Do not correct wording that is merely different; only correct facts (numbers, durations, requirements, yes/no). Return every claim.`,
    prompt: `CLAIMS\n${claims.map((c) => `[${c.key}] ${c.text}`).join("\n")}\n\nSOURCES (freshly fetched today)\n${pages.map(({ s, p }) => `### ${s.title} — ${s.url}\n${p.text}`).join("\n\n")}\n\n${probeText}`,
    schema: toJSONSchema(Findings) as Record<string, unknown>,
    timeoutMs: 90_000,
    signal: ctx.signal,
  });
  const parsed = Findings.parse(JSON.parse(res.text));
  const applied: string[] = [];
  const findings: Finding[] = [];
  for (const f of parsed.findings) {
    const claim = claims.find((c) => f.claim.includes(`[${c.key}]`) || c.text.startsWith(f.claim.slice(0, 40))) ?? claims.find((c) => f.claim.toLowerCase().includes(c.field.split(".").pop()!.replace("_", " ")));
    const label = claim ? claim.text : f.claim;
    findings.push({ claim: label.replace(/^\[c\d\]\s*/, "").slice(0, 300), result: f.result, note: f.note.slice(0, 400), quote: f.quote?.slice(0, 300) || undefined });
    const nonAnswer = /not (mentioned|specified|stated|documented|discussed)|does not mention|unclear|unknown|cannot be determined/i.test(f.corrected_value ?? "");
    if (f.result === "corrected" && nonAnswer) {
      // "Corrected" to "the docs don't say" is not a correction; keep the guide's value and log it as unverified.
      f.result = "unverified";
      findings[findings.length - 1].result = "unverified";
    }
    if (f.result === "corrected" && claim?.apply && f.corrected_value && f.corrected_value.length <= 200) {
      const value = f.corrected_value.replace(/^[^:]{0,40}:\s*/, "");
      claim.apply(value);
      applied.push(`Corrected ${claim.field} to "${value}" (source: ${f.quote?.slice(0, 80) || "see verification log"}).`);
    } else if (f.result === "unverified" && claim) {
      const line = `Automated re-check could not confirm: ${claim.text.slice(0, 160)}`;
      if (!g.uncertain.some((u) => u.startsWith("Automated re-check could not confirm"))) g.uncertain = [...g.uncertain, line];
      else g.uncertain = g.uncertain.map((u) => (u.startsWith("Automated re-check could not confirm") && !u.includes(claim.text.slice(0, 40)) ? `${u}; ${claim.text.slice(0, 120)}` : u));
    }
  }
  return { findings, applied, model: res.model, pages: pages.length, probes: ctx.discovery ? 1 : 0 };
}

// ---------------------------------------------------------------------------------------

async function linkStatus(url: string): Promise<{ status?: number; error?: string }> {
  const chk = await checkPublicHttps(url);
  if (!chk.url) return { error: chk.error === "only https URLs are allowed" ? "not https" : chk.error === "host resolves to a private address" ? "private host" : chk.error };
  const attempt = async (method: "HEAD" | "GET") => {
    const res = await fetch(chk.url!, { method, redirect: "follow", signal: AbortSignal.timeout(9000), headers: { "user-agent": UA, accept: "text/html,*/*;q=0.8" } });
    if (method === "GET") await res.body?.cancel();
    return res.status;
  };
  try {
    const s = await attempt("HEAD");
    if (s === 405 || s === 403 || s === 400 || s === 404) return { status: await attempt("GET") };
    return { status: s };
  } catch (e) {
    try {
      return { status: await attempt("GET") };
    } catch {
      return { error: e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : e.message) : String(e) };
    }
  }
}

function classifyAuthorize(status?: number, location?: string | null, body?: string): string {
  const text = `${location ?? ""} ${body ?? ""}`.toLowerCase();
  if (status && status >= 300 && status < 400) {
    if (/login|signin|sign-in|auth/.test(location ?? "")) return "redirects to a sign-in page (endpoint exists; the dummy client is challenged at login).";
    if (/invalid_client|error/.test(text)) return "redirects to an error page that rejects the unknown client (endpoint exists).";
    return `redirects to ${location?.slice(0, 80)}.`;
  }
  if (status === 400 || status === 401) return "rejects the unknown client with a 4xx error (endpoint exists and validates client_id).";
  if (status === 200) return /invalid|unknown|not found|error/.test(text) ? "returns an error page for the unknown client (endpoint exists)." : "serves a page (endpoint exists).";
  if (status === 404) return "404: the URL does not exist as written.";
  return `responded (${status}).`;
}

/** `{shop}.myshopify.com`, `<tenant>`, `YOUR_DOMAIN`, … : no fixed host to probe. */
function isPlaceholder(url: string): boolean {
  return /[{}<>[\]]|\byour[-_]?(domain|shop|store|tenant|company|instance|subdomain|org|site)\b|\bexample\.(com|org)\b/i.test(url.split("?")[0]);
}

function withParams(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);
