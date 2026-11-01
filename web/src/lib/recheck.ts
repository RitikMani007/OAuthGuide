import "server-only";
import { z } from "zod";
import { toJSONSchema } from "zod";
import type { StoredGuide } from "./schema";
import { readPage, searchAll, type Page, type SearchResult } from "./web";
import { httpProbe } from "./probe";
import { gemini, geminiReadUrls, FAST_MODELS, WRITER_MODELS } from "./gemini";

// The second pass for a guide: the same job the independent agent did for the curated
// library, done by code plus a model that did not write the guide. It reads every cited
// page in full, cuts out the passages that bear on each claim, follows on-topic links and
// search results for what is still open, runs extra live probes for PKCE and token claims,
// and judges in up to two rounds. Only evidence gathered here may be used.

export type Finding = NonNullable<StoredGuide["meta"]["verification"]>["findings"][number];
export type RecheckContext = { dead: Set<string>; unreachable: Set<string>; discovery: Record<string, unknown> | null; signal?: AbortSignal };
export type RecheckEvent = { type: "note"; text: string };
export type RecheckOutcome = { findings: Finding[]; applied: string[]; model: string; method: string; skipped: number };

type Claim = { key: string; field: string; text: string; re: RegExp; apply?: (v: string) => void };
type Excerpt = { url: string; title: string; text: string };

const Findings = z.object({
  findings: z.array(
    z.object({
      claim: z.string().describe("the claim key in brackets, e.g. [c2]"),
      result: z.enum(["confirmed", "corrected", "unverified"]),
      note: z.string().describe("one or two sentences: what the evidence says, or what is missing"),
      quote: z.string().describe("the exact supporting sentence from the evidence, or empty"),
      corrected_value: z.string().describe("only when result is corrected: the corrected short statement (max 200 chars), else empty"),
    }),
  ),
});
const Selection = z.object({
  read: z.array(z.string()).describe("up to 5 URLs from the candidates, most likely to settle the open claims"),
});

const TOPIC = /review|approv|verif|certif|publish|marketplace|listing|directory|partner|token|refresh|expir|pkce|oauth|auth|scope|permission|limit|quota|rate|sandbox|test|production|install|app|client|console|dashboard|register|redirect|callback|origin|faq|changelog|polic|privacy|security/i;
const UNKNOWN = /^\s*(unknown|not documented|not specified|not stated|n\/a|unclear)\b/i;

export async function* recheckClaims(g: StoredGuide, ctx: RecheckContext): AsyncGenerator<RecheckEvent, RecheckOutcome> {
  const started = Date.now();
  const elapsed = () => (Date.now() - started) / 1000;
  const words = (s: string) => [...new Set(s.toLowerCase().match(/[a-z][a-z0-9_.-]{4,}/g) ?? [])].filter((w) => !STOP.has(w)).slice(0, 8);
  const rx = (...parts: (string | RegExp)[]) => new RegExp(parts.map((p) => (p instanceof RegExp ? p.source : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("|"), "i");

  // ---- the claims ------------------------------------------------------------------
  const all: Claim[] = [
    { key: "c1", field: "verdict.headline_blocker", text: `The single most likely blocker is: ${g.verdict.headline_blocker}`, re: rx(...words(g.verdict.headline_blocker), /redirect|origin|allowed|verif|review|approval|restrict/), apply: (v) => (g.verdict.headline_blocker = v) },
    { key: "c2", field: "review.typical_duration", text: `Review/approval typically takes: ${g.review.typical_duration}`, re: /review|approv|verification|certif|publish|marketplace|listing|business day|\bdays?\b|\bweeks?\b|turnaround|timeline/i, apply: (v) => (g.review.typical_duration = v) },
    { key: "c3", field: "review.required_when", text: `Review is required when: ${g.review.required_when}`, re: /review|approv|required|mandatory|publish|public|private|internal|marketplace|listing|submit|unverified|unlisted/i },
    { key: "c4", field: "oauth.pkce", text: `PKCE: ${g.oauth.pkce}`, re: /pkce|code[_ ]challenge|code[_ ]verifier|s256|proof key/i, apply: (v) => (g.oauth.pkce = v) },
    { key: "c5", field: "oauth.refresh_tokens", text: `Tokens and refresh: ${g.oauth.refresh_tokens}`, re: /refresh|expir|lifetime|valid for|rotat|revok|offline[_ ]access|\b\d+\s*(seconds|minutes|hours|days)\b|long-lived|short-lived/i, apply: (v) => (g.oauth.refresh_tokens = v) },
  ];
  const cap = g.stages.find((s) => /\d/.test(s.what_you_get));
  if (cap) all.push({ key: "c6", field: "stages", text: `Stage "${cap.name}": ${cap.what_you_get}`, re: rx(...words(cap.what_you_get), /\b\d+\s*(users?|installs?|accounts?|requests?|calls?)\b|limit|cap\b|quota|sandbox|test mode|development mode|production/) });
  const restricted = g.scopes.filter((s) => s.tier === "restricted" || s.tier === "partner-only").slice(0, 3);
  if (restricted.length) all.push({ key: "c7", field: "scopes", text: `These scopes are ${restricted[0].tier}: ${restricted.map((s) => `${s.scope} (${s.review_impact})`).join("; ")}`, re: rx(...restricted.map((s) => s.scope), /restricted|sensitive|partner|approval|review|elevated|privileged/) });
  const claims = all.filter((c) => !UNKNOWN.test(c.text.split(": ").slice(1).join(": ")));
  const skipped = all.length - claims.length;
  if (skipped) yield { type: "note", text: `${skipped} claim${skipped > 1 ? "s" : ""} the guide states as unknown ${skipped > 1 ? "are" : "is"} not counted. ` };

  // ---- 1. read every cited page in full -------------------------------------------
  const cited = g.sources.filter((s) => s.kind !== "tested" && !ctx.dead.has(s.id)).slice(0, 14);
  yield { type: "note", text: `Reading ${cited.length} cited pages in full… ` };
  const readSet = new Set<string>(cited.map((s) => s.url));
  const pages: Page[] = [];
  const readable = (p: Page) => !p.error || p.text.length > 400;
  const first = await mapLimit(cited, 6, (s) => readPage(s.url, 60_000));
  pages.push(...first.filter(readable));
  const jsOnly = first.filter((p) => !readable(p) && !/HTTP 404|HTTP 410|DNS|not https|private/.test(p.error ?? "")).map((p) => p.url).slice(0, 6);
  if (jsOnly.length && elapsed() < 60) {
    yield { type: "note", text: `${jsOnly.length} page${jsOnly.length > 1 ? "s" : ""} need JavaScript; using the URL reader. ` };
    try {
      const { extracts } = await geminiReadUrls(jsOnly, `${g.name} OAuth app registration: app review or approval requirements and timelines, PKCE, token and refresh-token lifetimes, user or install limits before approval, restricted scopes, redirect URI rules`, ctx.signal);
      pages.push(...extracts.map((e) => ({ url: e.url, title: `${e.url} (URL reader)`, text: e.text, links: [] })));
    } catch {
      /* the reader is best-effort */
    }
  }
  if (!pages.length) throw new Error("none of the cited pages could be read");

  // ---- 2. follow on-topic links from those pages, scored against the open claims ---
  let links = 0;
  const scoreLink = (l: { url: string; text: string }) => claims.reduce((n, c) => n + (c.re.test(l.url + " " + l.text) ? 1 : 0), 0) + (TOPIC.test(l.url + " " + l.text) ? 0.5 : 0);
  const siteOf = (u: string) => new URL(u).hostname.split(".").slice(-2).join(".");
  const sites = new Set(pages.map((p) => siteOf(p.url)));
  if (elapsed() < 75) {
    const cands = [...new Map(pages.flatMap((p) => p.links).map((l) => [l.url, l])).values()]
      .filter((l) => !readSet.has(l.url) && !/\/(blog|tags?|categor|search|login|signup|pricing|careers|legal)\b/i.test(l.url))
      .map((l) => ({ ...l, score: scoreLink(l) }))
      .filter((l) => l.score >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    if (cands.length) {
      yield { type: "note", text: `Following ${cands.length} on-topic links (${cands.map((c) => c.text || c.url.replace(/^https?:\/\/[^/]+/, "")).slice(0, 4).join("; ")}…). ` };
      for (const c of cands) readSet.add(c.url);
      const more = (await mapLimit(cands, 4, (c) => readPage(c.url, 40_000))).filter(readable).filter((p) => !pages.some((q) => q.url === p.url));
      links = more.length;
      pages.push(...more);
    }
  }

  // ---- 3. search for what cited pages are unlikely to cover --------------------------
  let searches = 0;
  let searchResults: SearchResult[] = [];
  if (elapsed() < 90) {
    const queries = [`${g.name} OAuth app review approval how long`, `${g.name} OAuth app publish verification required`, `${g.name} OAuth refresh token expiration`];
    try {
      const sets = await searchAll(queries, 6);
      searches = sets.filter((s) => s.length).length;
      searchResults = dedupe(sets.flat()).filter((r) => !readSet.has(r.url));
      const onSite = searchResults.filter((r) => sites.has(siteOf(r.url)) || siteOf(r.url) === siteOf(g.website || "https://x.invalid")).slice(0, 4);
      if (onSite.length) {
        yield { type: "note", text: `Search found ${searchResults.length} results; reading ${onSite.length} from the provider's own sites. ` };
        for (const r of onSite) readSet.add(r.url);
        const more = (await mapLimit(onSite, 4, (r) => readPage(r.url, 40_000))).filter(readable).filter((p) => !pages.some((q) => q.url === p.url));
        pages.push(...more);
      } else if (!searches) yield { type: "note", text: "Web search is unavailable (bot-blocked); relying on cited pages and links. " };
    } catch {
      /* search is best-effort */
    }
  }

  // ---- 4. live probes that settle PKCE and token claims ------------------------------
  const probeNotes: string[] = [];
  const d = ctx.discovery;
  if (d) {
    const m = Array.isArray(d.code_challenge_methods_supported) ? (d.code_challenge_methods_supported as string[]) : null;
    if (m) probeNotes.push(`Discovery document: code_challenge_methods_supported = ${JSON.stringify(m)} (PKCE ${m.length ? "supported" : "not advertised"}).`);
    const gt = Array.isArray(d.grant_types_supported) ? (d.grant_types_supported as string[]) : null;
    if (gt) probeNotes.push(`Discovery document: grant_types_supported = ${JSON.stringify(gt)} (refresh_token grant ${gt.includes("refresh_token") ? "supported" : "not listed"}).`);
    const sc = Array.isArray(d.scopes_supported) ? (d.scopes_supported as string[]) : null;
    if (sc) probeNotes.push(`Discovery document: scopes_supported includes ${sc.slice(0, 20).join(", ")}${sc.length > 20 ? "…" : ""}${sc.includes("offline_access") ? " (offline_access present: refresh tokens are issued on request)" : ""}.`);
  }
  const auth = g.oauth.authorize_url;
  if (auth && /^https:\/\//.test(auth) && !/[{}<>]/.test(auth) && elapsed() < 100) {
    const base = withParams(auth, { client_id: "test_probe", response_type: "code", redirect_uri: "https://example.com/cb", scope: g.scopes[0]?.scope ?? "" });
    const [plain, pk] = await Promise.all([httpProbe(base), httpProbe(withParams(base, { code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method: "S256" }))]);
    const txt = (r: typeof plain) => `${r.location ?? ""} ${r.body_excerpt ?? ""}`.toLowerCase();
    const demandsPkce = /code_challenge|pkce/.test(txt(plain)) && /required|missing|must/.test(txt(plain));
    const rejectsPkce = /code_challenge|pkce/.test(txt(pk)) && /unsupported|invalid|unknown|not supported/.test(txt(pk));
    probeNotes.push(`Live probe of the authorize endpoint with a dummy client: without code_challenge → HTTP ${plain.status ?? plain.error}${demandsPkce ? " and the response demands a code_challenge (PKCE enforced for this request)" : " with no complaint about a missing code_challenge (PKCE not enforced at this point for an unknown client; it may still be enforced per client type)"}; with code_challenge/S256 → HTTP ${pk.status ?? pk.error}${rejectsPkce ? " and the parameter is rejected" : " and the parameter is accepted"}.`);
  }
  const token = g.oauth.token_url;
  if (token && /^https:\/\//.test(token) && !/[{}<>]/.test(token) && elapsed() < 105) {
    const r = await httpProbe(token, { method: "POST", body: "grant_type=refresh_token&refresh_token=test_probe&client_id=test_probe&client_secret=test_probe" });
    const body = (r.body_excerpt ?? "").slice(0, 300);
    const unsupported = /unsupported_grant_type/i.test(body);
    probeNotes.push(`Live probe of the token endpoint with a dummy refresh_token grant: HTTP ${r.status ?? r.error}${unsupported ? ", unsupported_grant_type (the refresh_token grant is NOT accepted)" : /invalid_grant|invalid_client|invalid_request|unauthorized_client|bad_verification/i.test(body) ? ", rejected with an OAuth error, so the refresh_token grant type is recognised" : ""}. Body: ${body.replace(/\s+/g, " ")}`);
  }

  // ---- 5. judge: claim-targeted excerpts from everything read ------------------------
  const evidence = (cs: Claim[]) => cs.map((c) => `## ${c.key}: ${c.text}\n${excerptsFor(pages, c).map((e) => `- [${e.title || e.url}] ${e.url}\n  ${e.text}`).join("\n") || "- (no passage in the material read mentions this)"}`).join("\n\n");
  const judge = async (cs: Claim[]) => {
    const res = await gemini({
      models: [...WRITER_MODELS, ...FAST_MODELS],
      system: `You are an independent fact-checker for a developer guide about registering an OAuth app with ${g.name}. You did not write the guide. Judge each claim using ONLY the evidence passages and live probe results provided (they were fetched today from the provider's own pages and endpoints):
- "confirmed": a passage or probe clearly supports the claim's substance (quote the sentence). Different wording with the same meaning is confirmed.
- "corrected": the evidence clearly contradicts a specific fact (a number, duration, requirement, yes/no). Put the corrected statement in corrected_value, short, same style as the claim's value, and quote the sentence. Never "correct" a claim to "the docs don't say".
- "unverified": the evidence does not settle it.
Live probe results count as evidence for PKCE and token claims. Return every claim, using its key in brackets as the claim field.`,
      prompt: `CLAIMS AND EVIDENCE\n\n${evidence(cs)}\n\nLIVE PROBE RESULTS\n${probeNotes.map((p) => `- ${p}`).join("\n") || "- none"}`,
      schema: toJSONSchema(Findings) as Record<string, unknown>,
      timeoutMs: 90_000,
      signal: ctx.signal,
    });
    return { parsed: Findings.parse(JSON.parse(res.text)), model: res.model };
  };
  yield { type: "note", text: `Judging ${claims.length} claims against ${pages.length} pages and ${probeNotes.length} probe results… ` };
  let { parsed, model } = await judge(claims);
  const byKey = new Map(parsed.findings.map((f) => [keyOf(f.claim, claims), f]));

  // ---- 6. second round for what is still open: the model picks pages to read ---------
  const open = claims.filter((c) => byKey.get(c.key)?.result !== "confirmed" && byKey.get(c.key)?.result !== "corrected");
  if (open.length && elapsed() < 120) {
    const cands = [
      ...[...new Map(pages.flatMap((p) => p.links).map((l) => [l.url, l])).values()].filter((l) => !readSet.has(l.url) && TOPIC.test(l.url + " " + l.text)).slice(0, 120).map((l) => `${l.url} | link text: ${l.text}`),
      ...searchResults.filter((r) => !readSet.has(r.url)).slice(0, 20).map((r) => `${r.url} | search: ${r.title} — ${r.snippet.slice(0, 140)}`),
    ];
    if (cands.length) {
      try {
        const sel = await gemini({
          models: FAST_MODELS,
          system: "You pick documentation pages that would settle specific open claims about a provider's OAuth app program. Return only URLs from the candidates. Prefer the provider's official docs: app review, publishing, verification, token lifetime, PKCE and scope pages.",
          prompt: `Open claims:\n${open.map((c) => `- ${c.text}`).join("\n")}\n\nCandidates:\n${cands.join("\n")}`,
          schema: toJSONSchema(Selection) as Record<string, unknown>,
          timeoutMs: 30_000,
          signal: ctx.signal,
        });
        const allowed = new Set(cands.map((c) => c.split(" | ")[0]));
        const next = Selection.parse(JSON.parse(sel.text)).read.filter((u) => allowed.has(u) && !readSet.has(u)).slice(0, 5);
        if (next.length) {
          yield { type: "note", text: `Still open: ${open.map((c) => c.field).join(", ")}. Reading ${next.length} more pages the checker asked for… ` };
          for (const u of next) readSet.add(u);
          const more = (await mapLimit(next, 4, (u) => readPage(u, 40_000))).filter(readable).filter((p) => !pages.some((q) => q.url === p.url));
          links += more.length;
          if (more.length) {
            pages.push(...more);
            const second = await judge(open);
            model = second.model;
            for (const f of second.parsed.findings) {
              const k = keyOf(f.claim, open);
              if (k && (f.result !== "unverified" || !byKey.has(k))) byKey.set(k, f);
            }
            parsed = { findings: claims.map((c) => byKey.get(c.key)).filter((f): f is NonNullable<typeof f> => !!f) };
          }
        }
      } catch {
        /* the second round is best-effort */
      }
    }
  }

  // ---- 7. apply --------------------------------------------------------------------
  const applied: string[] = [];
  const findings: Finding[] = [];
  for (const c of claims) {
    const f = byKey.get(c.key);
    if (!f) {
      findings.push({ claim: c.text.slice(0, 300), result: "unverified", note: "The checker returned no verdict for this claim.", quote: undefined });
      continue;
    }
    const nonAnswer = /not (mentioned|specified|stated|documented|discussed)|does not mention|unclear|unknown|cannot be determined/i.test(f.corrected_value ?? "");
    const result = f.result === "corrected" && nonAnswer ? "unverified" : f.result;
    findings.push({ claim: c.text.slice(0, 300), result, note: f.note.slice(0, 400), quote: f.quote?.slice(0, 300) || undefined });
    if (result === "corrected" && c.apply && f.corrected_value && f.corrected_value.length <= 200) {
      const value = f.corrected_value.replace(/^[^:]{0,40}:\s*/, "");
      c.apply(value);
      applied.push(`Corrected ${c.field} to "${value}" (source: ${f.quote?.slice(0, 80) || "see verification log"}).`);
    } else if (result === "unverified") {
      const line = `Automated re-check could not confirm: ${c.text.slice(0, 160)}`;
      if (!g.uncertain.some((u) => u.startsWith("Automated re-check could not confirm"))) g.uncertain = [...g.uncertain, line];
      else g.uncertain = g.uncertain.map((u) => (u.startsWith("Automated re-check could not confirm") && !u.includes(c.text.slice(0, 40)) ? `${u}; ${c.text.slice(0, 120)}` : u));
    }
  }
  const method = `Independent re-check of ${claims.length} high-impact claims by a model that did not write the guide, against ${pages.length} pages read in full today (${cited.length} cited, ${links} reached by following links${searches ? `, ${searches} web searches` : ""}) and ${probeNotes.length} live probe results, in ${open.length && links ? "two" : "one"} judging round${open.length && links ? "s" : ""}.${skipped ? ` ${skipped} claim${skipped > 1 ? "s" : ""} the guide states as unknown ${skipped > 1 ? "were" : "was"} not counted.` : ""}`;
  return { findings, applied, model, method, skipped };
}

// ---------------------------------------------------------------------------------------

const STOP = new Set(["their", "there", "these", "those", "which", "while", "where", "would", "could", "should", "about", "after", "before", "other", "under", "every", "within", "without", "being", "through", "between", "because", "https", "apps", "application", "applications", "oauth", "developer", "developers", "account", "accounts", "requires", "required", "require"]);

function excerptsFor(pages: Page[], c: Claim, perPage = 3, radius = 350): Excerpt[] {
  const out: Excerpt[] = [];
  for (const p of pages) {
    const windows: [number, number][] = [];
    const re = new RegExp(c.re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(p.text)) && windows.length < perPage * 3) {
      const s = Math.max(0, m.index - radius);
      const e = Math.min(p.text.length, m.index + m[0].length + radius);
      const last = windows[windows.length - 1];
      if (last && s <= last[1]) last[1] = e;
      else windows.push([s, e]);
      if (windows.length >= perPage) break;
    }
    for (const [s, e] of windows) out.push({ url: p.url, title: p.title.slice(0, 80), text: p.text.slice(s, e).replace(/\s+/g, " ").trim() });
    if (out.length > 24) break;
  }
  return out.slice(0, 24);
}

function keyOf(label: string, claims: Claim[]): string | undefined {
  const m = label.match(/\[(c\d)\]/);
  if (m && claims.some((c) => c.key === m[1])) return m[1];
  return claims.find((c) => label.trim().startsWith(c.key) || label.includes(c.text.slice(0, 40)))?.key;
}

function dedupe(rs: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return rs.filter((r) => !seen.has(r.url) && seen.add(r.url));
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
