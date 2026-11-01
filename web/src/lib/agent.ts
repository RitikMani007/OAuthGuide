import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { toJSONSchema } from "zod";
import { Guide, type StoredGuide } from "./schema";
import { composioManagedMatch, directoryContext } from "./composio";
import { resolveLogo } from "./directory";
import { httpProbe } from "./probe";
import { slugify, saveGenerated } from "./store";
import { enforceEvidence } from "./evidence";

export const MODEL = "claude-opus-5-5";
const BETAS = ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"];

import type { CheckResult, StoredGuide as SG } from "./schema";

export type AgentEvent =
  | { type: "phase"; phase: "research" | "synthesis" | "saving" | "verify" | "done"; message: string }
  | { type: "check"; result: CheckResult }
  | { type: "claim"; finding: NonNullable<SG["meta"]["verification"]>["findings"][number] }
  | { type: "verified"; summary: { pass: number; warn: number; fail: number; skip: number }; claims: number; applied: number }
  | { type: "search"; query: string }
  | { type: "search_results"; count: number }
  | { type: "fetch"; url: string }
  | { type: "probe"; url: string; status?: number; error?: string }
  | { type: "note"; text: string }
  | { type: "progress"; chars: number }
  | { type: "guide"; slug: string }
  | { type: "error"; message: string };

const RESEARCH_SYSTEM = `You are an OAuth integration investigator. A developer building an AI agent product needs to register THEIR OWN OAuth app with a provider so their end users can connect accounts, and get that app ready for production (approved/verified/listed as needed).

Your job: investigate the provider and produce a research dossier that another step will turn into a guide. Prefer official developer documentation. Look for:
- Where and how to register an OAuth app (console URL, account prerequisites such as a company page, partner program, paid plan, developer account, sandbox).
- App types (e.g. public vs internal, OAuth app vs platform app) and which one an AI agent product should choose.
- Authorize/token endpoints, redirect URI rules (https, localhost, exact match), PKCE, token lifetimes, refresh tokens.
- Scopes, and which ones trigger review, security assessment, or partner-only access. Note scopes an AI agent typically needs (read/write user data).
- The ladder from test app to production: user caps, unverified warnings, install limits, review/verification/marketplace processes, what must be prepared (privacy policy, demo video, domain verification, security questionnaire), and realistic timelines.
- Common blockers/rejections and their fixes; recent policy changes (especially affecting AI/LLM use of data or rate limits for unlisted apps).

You have an http_probe tool. USE IT to test facts, not just read them: fetch OIDC/OAuth discovery documents (e.g. https://<issuer>/.well-known/openid-configuration or /.well-known/oauth-authorization-server) to confirm endpoints, PKCE methods and scopes; hit the authorize endpoint with client_id=test_probe&response_type=code&redirect_uri=https://example.com/cb to confirm it exists and see how it rejects unknown clients. Record exactly what you observed.

Be efficient: about 4–8 searches and 4–8 fetches is usually enough. Finish with a dossier in plain text with these sections: FACTS (each line ends with [source URL] or [PROBE: what you observed]), TIMELINES, BLOCKERS, UNCERTAIN (things you could not confirm or found conflicting), SOURCES (title — URL, mark official/community). Never invent URLs.`;

export const SYNTH_SYSTEM = `You turn an OAuth research dossier into a developer-facing setup guide as JSON matching the provided schema.

Rules:
- Ground every claim in the dossier. evidence = "tested" ONLY for facts confirmed by an http_probe observation in the dossier; "sourced" when a cited source supports it; otherwise "inferred". Never upgrade evidence.
- source_ids must reference entries in sources (ids s1, s2, …); include probe observations as sources with kind "tested" and the probed URL.
- Steps must be concrete and ordered (exact console paths and fields where known). owner: "agent" for things an AI agent can do for the developer (look up, draft privacy policy text, generate manifests/config, write scope justifications, prepare redirect URI lists, script API calls); "you" for things requiring the human (logging in, accepting terms, identity/business verification, payment, recording demo video, legal sign-off); "wait" for provider review or approval time.
- Be honest about difficulty: 1 Instant (create and use immediately), 2 Easy (self-serve, minor setup), 3 Moderate (review or verification needed to go public), 4 Hard (multi-week review, security assessment, or business verification), 5 Gated (partner program/contract required for useful access).
- Put anything unconfirmed, conflicting or likely to change into "uncertain". Keep it scannable: short sentences, no marketing.`;

const probeTool: Anthropic.Beta.BetaTool = {
  name: "http_probe",
  description:
    "HTTPS GET a public URL without following redirects and return status, Location header, content-type and the first ~6KB of the body. Use it to fetch OAuth/OIDC discovery documents and to probe authorize endpoints with a dummy client_id.",
  input_schema: {
    type: "object",
    properties: { url: { type: "string", description: "Absolute https URL" } },
    required: ["url"],
    additionalProperties: false,
  },
  strict: true,
};

function client() {
  return new Anthropic({ timeout: 280_000, maxRetries: 1 });
}

export async function* generateGuideClaude(input: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  const anthropic = client();
  const managed = composioManagedMatch(input);

  yield { type: "phase", phase: "research", message: `Investigating "${input}"…` };

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Investigate OAuth app registration and production approval for: ${input}\n\nIf this is a website or ambiguous name, first identify the product and its developer platform. If the product does not offer OAuth for third-party apps, say so clearly in the dossier and describe the alternative (API keys, partner program, etc.).`,
    },
  ];

  let dossier = "";
  // Manual loop: server tools (web_search/web_fetch) run on Anthropic's side and
  // may pause the turn; http_probe runs here.
  for (let turn = 0; turn < 12; turn++) {
    if (signal?.aborted) return;
    const stream = anthropic.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 32000,
        betas: BETAS,
        fallbacks: "default",
        thinking: { type: "adaptive", display: "updates" },
        output_config: { effort: "medium" },
        system: RESEARCH_SYSTEM,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 8 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10, max_content_tokens: 20000 },
          probeTool,
        ],
        messages,
      },
      { signal },
    );

    // Accumulate server tool inputs so we can show queries/URLs as they happen.
    const partial: Record<number, { name: string; json: string }> = {};
    for await (const ev of stream) {
      if (ev.type === "content_block_start") {
        const b = ev.content_block;
        if (b.type === "server_tool_use" || b.type === "tool_use") partial[ev.index] = { name: b.name, json: "" };
        if (b.type === "web_search_tool_result" && Array.isArray(b.content))
          yield { type: "search_results", count: b.content.length };
      } else if (ev.type === "content_block_delta") {
        if (ev.delta.type === "input_json_delta" && partial[ev.index]) partial[ev.index].json += ev.delta.partial_json;
        else if (ev.delta.type === "thinking_delta" && ev.delta.thinking.trim()) yield { type: "note", text: ev.delta.thinking };
      } else if (ev.type === "content_block_stop" && partial[ev.index]) {
        const { name, json } = partial[ev.index];
        let args: { query?: string; url?: string } = {};
        try {
          args = JSON.parse(json || "{}");
        } catch {}
        if (name === "web_search" && args.query) yield { type: "search", query: args.query };
        if (name === "web_fetch" && args.url) yield { type: "fetch", url: args.url };
      }
    }
    const msg = await stream.finalMessage();
    messages.push({ role: "assistant", content: msg.content });

    if (msg.stop_reason === "refusal") {
      yield { type: "error", message: "The model declined this request." };
      return;
    }
    if (msg.stop_reason === "pause_turn") continue;

    const toolUses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason === "tool_use" && toolUses.length) {
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const t of toolUses) {
        const url = typeof (t.input as { url?: unknown })?.url === "string" ? (t.input as { url: string }).url : "";
        if (t.name !== "http_probe" || !url) {
          results.push({ type: "tool_result", tool_use_id: t.id, is_error: true, content: "invalid tool call" });
          continue;
        }
        const r = await httpProbe(url);
        yield { type: "probe", url, status: r.status, error: r.error };
        results.push({ type: "tool_result", tool_use_id: t.id, content: JSON.stringify(r), is_error: !!r.error });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    dossier = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    break;
  }

  if (!dossier.trim()) {
    yield { type: "error", message: "Research did not produce a dossier (turn limit reached)." };
    return;
  }

  yield { type: "phase", phase: "synthesis", message: "Writing the guide from what the agent found…" };

  const today = new Date().toISOString().slice(0, 10);
  const synth = anthropic.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 32000,
      betas: BETAS,
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: guideJsonSchema() } },
      system: SYNTH_SYSTEM,
      messages: [
        {
          role: "user",
          content: `App requested: ${input}
Suggested slug: ${slugify(input)}
Today: ${today}
Composio managed OAuth app listed for this toolkit: ${managed ? `yes ("${managed}")` : "not found in the managed list (set composio_managed to false if the name clearly matches nothing, null if unsure)"}.
${directoryContext(input)}

<dossier>
${dossier}
</dossier>`,
        },
      ],
    },
    { signal },
  );

  let chars = 0;
  let lastReport = 0;
  for await (const ev of synth) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      chars += ev.delta.text.length;
      if (chars - lastReport > 1500) {
        lastReport = chars;
        yield { type: "progress", chars };
      }
    }
  }
  const final = await synth.finalMessage();
  if (final.stop_reason === "refusal") {
    yield { type: "error", message: "The model declined to write this guide." };
    return;
  }
  if (final.stop_reason === "max_tokens") {
    yield { type: "error", message: "Guide output was truncated; try again." };
    return;
  }
  const text = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = Guide.safeParse(JSON.parse(text));
  if (!parsed.success) {
    yield { type: "error", message: `Guide failed validation: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") + " " + i.message).join("; ")}` };
    return;
  }

  yield { type: "phase", phase: "saving", message: "Saving shareable guide…" };
  const guide: StoredGuide = {
    ...enforceEvidence(parsed.data),
    slug: slugify(parsed.data.slug || input),
    meta: { origin: "generated", generated_at: new Date().toISOString(), model: final.model, dossier, logo: resolveLogo({ name: parsed.data.name, website: parsed.data.website, query: input }) },
  };
  await saveGenerated(guide);
  yield { type: "guide", slug: guide.slug };
}

let cachedSchema: Record<string, unknown> | null = null;
export function guideJsonSchema() {
  if (!cachedSchema) {
    // zod v4 native JSON Schema export; strip keywords structured outputs rejects.
    const s = toJSONSchema(Guide, { target: "draft-7" }) as Record<string, unknown>;
    cachedSchema = strip(s) as Record<string, unknown>;
  }
  return cachedSchema;
}

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"].includes(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return node;
}
