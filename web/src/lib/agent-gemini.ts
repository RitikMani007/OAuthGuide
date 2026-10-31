import "server-only";
import { z, toJSONSchema } from "zod";
import { Guide, type StoredGuide } from "./schema";
import { composioManagedMatch } from "./composio";
import { httpProbe, type ProbeResult } from "./probe";
import { searchAll, readPage, type SearchResult, type Page } from "./web";
import { gemini, geminiReadUrls, FAST_MODELS, WRITER_MODELS } from "./gemini";
import { SYNTH_SYSTEM, guideJsonSchema, type AgentEvent } from "./agent";
import { slugify, saveGenerated } from "./store";
import { enforceEvidence } from "./evidence";

// Gemini pipeline. The free tier has slow, rate-limited models and no free search
// grounding, so instead of an open-ended tool loop the agent works in three model
// calls: plan → select sources → write. Code in between reads the docs pages the
// model expects to exist (dead URLs are discarded, never cited), follows on-topic
// links found on them, tries keyless web search, and probes OAuth endpoints.

const Plan = z.object({
  product: z.string().describe("canonical product name"),
  developer_docs_domain: z.string().describe("host of the official developer docs, e.g. developers.zoom.us"),
  likely_supports_oauth: z.boolean(),
  doc_urls: z
    .array(z.string())
    .describe("6-10 official documentation URLs you believe exist: OAuth/auth guide, app creation, scopes, app review/publishing/marketplace, verification/security requirements, rate limits, changelog"),
  queries: z.array(z.string()).describe("3-5 web search queries, no site: operator"),
  probe_urls: z.array(z.string()).describe("0-4 https URLs to probe: OIDC/OAuth discovery docs, authorize endpoint with client_id=test_probe"),
});

const Selection = z.object({
  read: z.array(z.string()).describe("up to 8 URLs to read next, copied exactly from the candidate list, most useful first"),
  missing: z.string().describe("the most important question the pages read so far do not answer"),
});

const schemaOf = (s: z.ZodType) => {
  const j = toJSONSchema(s, { target: "draft-7" }) as Record<string, unknown>;
  delete j.$schema;
  return j;
};

const PLAN_SYSTEM = `You plan research into how a developer registers their own OAuth app with a provider (so end users can connect accounts to an AI agent product) and gets it approved for production.
- doc_urls: the official developer documentation pages most likely to answer: how to create an OAuth app, OAuth flow/endpoints/token lifetimes, scopes (and which need review), app review / publishing / marketplace listing / verification requirements and timelines, rate limits for unlisted apps, recent policy changes. Use real URLs you are confident about; they will be fetched and any that do not exist are discarded. The developer docs host often differs from the marketing or marketplace host (developers.example.com, docs.example.com, api.example.com).
- queries: product name + "developer"/"API" + topic. Never use the site: operator.
- probe_urls: the provider's OIDC discovery document or OAuth authorization-server metadata if one likely exists, and the authorize endpoint with client_id=test_probe&response_type=code&redirect_uri=https://example.com/cb.`;

const SELECT_SYSTEM = `You choose which pages to read next for OAuth app setup and approval research. Candidates are links found on official docs pages already read, plus web search results. Prefer official pages about: creating/registering an app, OAuth flow and token lifetimes, scopes, app review / publishing / marketplace / verification requirements and timelines, rate limits, policy changes. Skip pages about unrelated APIs, SDK reference for individual endpoints, marketing, and duplicates. Copy URLs exactly.`;

const TOPIC = /oauth|auth|scope|permission|review|publish|submit|marketplace|listing|verif|security|app[-_ ]?(creat|regist|config|type)|create[-_ ]app|rate[-_ ]?limit|token|consent|distribut|requirement|guideline|policy|changelog/i;

export async function* generateGuideGemini(input: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  const managed = composioManagedMatch(input);

  // 1. Plan
  yield { type: "phase", phase: "research", message: `Planning research for "${input}"…` };
  const planRes = await gemini({ models: [WRITER_MODELS[0], ...FAST_MODELS], system: PLAN_SYSTEM, prompt: `App or website: ${input}`, schema: schemaOf(Plan), timeoutMs: 40_000, signal });
  const plan = Plan.parse(JSON.parse(planRes.text));
  yield { type: "note", text: `Identified ${plan.product} (developer docs: ${plan.developer_docs_domain}). ` };

  // 2. Read the docs the model expects to exist + probe endpoints + try search, all in parallel.
  const host = plan.developer_docs_domain.replace(/^https?:\/\//, "").split("/")[0];
  const docUrls = [...new Set([...plan.doc_urls.filter((u) => u.startsWith("https://")).slice(0, 10), `https://${host}/`, `https://${host}/docs/`])];
  const probeTargets = plan.probe_urls.filter((u) => u.startsWith("https://")).slice(0, 4);
  const queries = [`${plan.product} OAuth app developer documentation`, ...plan.queries.map((q) => q.replace(/\bsite:\S+/g, "").trim()).filter(Boolean)].slice(0, 4);
  for (const u of docUrls) yield { type: "fetch", url: u };
  for (const q of queries) yield { type: "search", query: q };
  const [firstPages, probes, searchSets] = await Promise.all([
    Promise.all(docUrls.map((u) => readPage(u, 9000))),
    Promise.all(probeTargets.map((u) => httpProbe(u))),
    searchAll(queries, 8).catch(() => [] as SearchResult[][]),
  ]);
  for (const p of probes) yield { type: "probe", url: p.url, status: p.status, error: p.error };
  const results = dedupe(searchSets.flat());
  yield { type: "search_results", count: results.length };
  const readable = (p: Page) => !p.error || p.text.length > 400;
  const pages: Page[] = firstPages.filter(readable).filter((p, i, a) => a.findIndex((q) => q.url === p.url) === i);
  const dead = firstPages.length - pages.length;
  yield { type: "note", text: `Read ${pages.length}/${firstPages.length} expected doc pages${dead ? ` (${dead} missing or unreadable)` : ""}; ${results.length} search results. ` };

  // JavaScript-rendered docs come back empty from a plain fetch; let Gemini's URL reader try them.
  const FOCUS = `registering an OAuth app with ${plan.product}, OAuth endpoints, token lifetimes, scopes, app review / certification / marketplace / verification requirements and timelines, install or user limits, rate limits for unlisted apps`;
  if (pages.length < 5) {
    const retry = firstPages.filter((p) => !readable(p) && !/HTTP 404|HTTP 410|DNS/.test(p.error ?? "")).map((p) => p.url).filter((u) => !/^\/(docs\/?)?$/.test(new URL(u).pathname));
    if (retry.length) {
      yield { type: "note", text: `Using Gemini's URL reader for ${retry.length} JavaScript-rendered pages. ` };
      const { extracts, errors } = await geminiReadUrls(retry.slice(0, 8), FOCUS, signal);
      if (!extracts.length && errors.length) yield { type: "note", text: `URL reader failed (${errors.join("; ").slice(0, 200)}). ` };
      for (const e of extracts) yield { type: "fetch", url: e.url };
      pages.push(...extracts.map((e) => ({ url: e.url, title: `${e.url} (extracted by Gemini URL reader)`, text: e.text, links: [] })));
    }
  }

  // 3. Up to two rounds: pick on-topic links found on pages read so far (plus search results), read them.
  const readSet = new Set<string>([...docUrls, ...firstPages.map((p) => p.url)]);
  let fresh = pages;
  for (let round = 0; round < 2 && fresh.length && pages.length < 9; round++) {
    const linkCands = [...new Map(fresh.flatMap((p) => p.links).map((l) => [l.url, l])).values()]
      .filter((l) => !readSet.has(l.url) && TOPIC.test(l.url + " " + l.text))
      .slice(0, 150);
    const searchCands = round === 0 ? results.filter((r) => !readSet.has(r.url)) : [];
    if (!linkCands.length && !searchCands.length) break;
    const cands = [
      ...linkCands.map((l) => `${l.url} | link text: ${l.text}`),
      ...searchCands.map((r) => `${r.url} | search: ${r.title} — ${r.snippet.slice(0, 160)}`),
    ];
    const selRes = await gemini({
      models: FAST_MODELS,
      system: SELECT_SYSTEM,
      prompt: `Product: ${plan.product}\nAlready read: ${pages.map((p) => `${p.title} (${p.url})`).join("; ")}\n\nCandidates:\n${cands.join("\n")}`,
      schema: schemaOf(Selection),
      timeoutMs: 40_000,
      signal,
    });
    const sel = Selection.parse(JSON.parse(selRes.text));
    const allowed = new Set([...linkCands.map((l) => l.url), ...searchCands.map((r) => r.url)]);
    const next = sel.read.filter((u) => allowed.has(u) && !readSet.has(u)).slice(0, round === 0 ? 7 : 5);
    if (sel.missing) yield { type: "note", text: `Looking for: ${sel.missing} ` };
    for (const u of next) {
      readSet.add(u);
      yield { type: "fetch", url: u };
    }
    fresh = (await Promise.all(next.map((u) => readPage(u, 9000)))).filter(readable);
    // Skip duplicates reached through redirects.
    fresh = fresh.filter((p) => !pages.some((q) => q.url === p.url));
    pages.push(...fresh);
  }

  if (!pages.length) {
    yield { type: "error", message: "Couldn't read any documentation for this app (pages missing or JavaScript-only, and web search unavailable). Try the provider's developer-docs URL instead of its name." };
    return;
  }
  const keep = pages.slice(0, 12);

  // 5. Write
  yield { type: "phase", phase: "synthesis", message: `Writing the guide from ${keep.length} pages and ${probes.length} probes…` };
  const dossier = buildDossier(plan.product, keep, probes, results);
  const today = new Date().toISOString().slice(0, 10);
  let chars = 0;
  const pending = gemini({
    models: WRITER_MODELS,
    system: `${SYNTH_SYSTEM}

Source ids: use the ids given in the dossier ([s1], [s2] … for pages, [p1], [p2] … for probes). Every id you reference in source_ids must appear in sources with the same URL. Only facts from PROBE entries may be evidence "tested". Facts not supported by the page excerpts must be "inferred" and should usually also be listed in "uncertain". Search-result snippets alone are weak evidence; mark facts that rely only on them as "inferred".
Completeness: write 7–12 concrete steps covering prepare → register → configure → test → review → launch (include steps for privacy policy/terms pages, scope selection, redirect URIs, testing with a real account, and review submission when relevant), 3–6 blockers with the error or symptom a developer would actually see, 2–4 stages, and every scope the dossier names that an AI agent would plausibly need. Do not import concepts from other providers (e.g. Google's CASA) unless this provider's pages mention them.`,
    prompt: `App requested: ${input}
Suggested slug: ${slugify(input)}
Today: ${today}
Composio managed OAuth app listed for this toolkit: ${managed ? `yes ("${managed}")` : "not found in the managed list (set composio_managed to false if the name clearly matches nothing, null if unsure)"}.

<dossier>
${dossier}
</dossier>`,
    schema: guideJsonSchema(),
    timeoutMs: 150_000,
    signal,
    onChunk: (c) => {
      chars = c;
    },
  }).then(
    (v) => ({ ok: v }),
    (e: unknown) => ({ err: e }),
  );
  // Heartbeat so the page shows progress while the (slow, free-tier) writer streams.
  let settled: { ok?: Awaited<ReturnType<typeof gemini>>; err?: unknown } | null = null;
  while (!settled) {
    settled = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
    if (!settled) yield { type: "progress", chars };
  }
  if (!settled.ok) throw settled.err;
  const writeRes = settled.ok;

  const parsed = Guide.safeParse(safeJson(writeRes.text));
  if (!parsed.success) {
    yield { type: "error", message: `Guide failed validation: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") + " " + i.message).join("; ")}` };
    return;
  }

  yield { type: "phase", phase: "saving", message: "Saving shareable guide…" };
  const reconciled = { ...parsed.data, sources: reconcileSources(parsed.data, keep, probes) };
  const guide: StoredGuide = {
    ...enforceEvidence(reconciled),
    slug: slugify(parsed.data.slug || input),
    meta: { origin: "generated", generated_at: new Date().toISOString(), model: `${writeRes.model} (plan/select: ${planRes.model})`, dossier },
  };
  await saveGenerated(guide);
  yield { type: "guide", slug: guide.slug };
  yield { type: "phase", phase: "done", message: "Done." };
}

function dedupe(rs: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return rs.filter((r) => {
    const k = r.url.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function buildDossier(product: string, pages: Page[], probes: ProbeResult[], results: SearchResult[]): string {
  const parts: string[] = [`PRODUCT: ${product}`, ""];
  pages.forEach((p, i) => parts.push(`=== [s${i + 1}] PAGE: ${p.title || p.url}\nURL: ${p.url}\n${p.text}\n`));
  probes.forEach((p, i) =>
    parts.push(
      `=== [p${i + 1}] PROBE (live HTTP GET, ${new Date().toISOString().slice(0, 10)}): ${p.url}\n${
        p.error ? `error: ${p.error}` : `status: ${p.status}\nlocation: ${p.location ?? "-"}\ncontent-type: ${p.content_type ?? "-"}\nbody: ${(p.body_excerpt ?? "").slice(0, 2500)}`
      }\n`,
    ),
  );
  parts.push("=== OTHER SEARCH RESULTS (snippets only, weak evidence)");
  results.slice(0, 20).forEach((r) => parts.push(`- ${r.title} — ${r.url}\n  ${r.snippet}`));
  return parts.join("\n");
}

/** Make sure every page/probe the guide cites is present with the right URL and kind. */
function reconcileSources(g: Guide, pages: Page[], probes: ProbeResult[]): Guide["sources"] {
  const byId = new Map(g.sources.map((s) => [s.id, s]));
  pages.forEach((p, i) => {
    const id = `s${i + 1}`;
    const existing = byId.get(id);
    const official = /developer|docs|api\.|support\./.test(new URL(p.url).hostname + new URL(p.url).pathname);
    byId.set(id, { id, title: existing?.title || p.title || p.url, url: p.url, kind: existing?.kind === "community" ? "community" : official ? "official" : existing?.kind ?? "community" });
  });
  probes.forEach((p, i) => {
    const id = `p${i + 1}`;
    byId.set(id, { id, title: byId.get(id)?.title || `Live probe: ${p.url}`, url: p.url, kind: "tested" });
  });
  const cited = new Set([...g.steps.flatMap((s) => s.source_ids), ...g.sources.map((s) => s.id)]);
  return [...byId.values()].filter((s) => cited.has(s.id) || s.id.startsWith("s") || s.id.startsWith("p"));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
}
