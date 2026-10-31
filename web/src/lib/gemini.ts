import "server-only";

// Minimal Gemini REST client. Free-tier latency and quotas vary a lot by model,
// so every call walks a fallback chain with a per-attempt timeout.

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const FAST_MODELS = (process.env.GEMINI_FAST_MODELS ?? "gemini-3.5-flash-lite,gemini-3.1-flash-lite").split(",");
export const WRITER_MODELS = (process.env.GEMINI_WRITER_MODELS ?? "gemini-3-flash-preview,gemini-3.6-flash,gemini-3.5-flash-lite").split(",");

type CallOpts = {
  models: string[];
  system: string;
  prompt: string;
  schema?: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
  onChunk?: (chars: number) => void;
};

export type GeminiResult = { text: string; model: string };

export class GeminiError extends Error {}

export async function gemini(opts: CallOpts): Promise<GeminiResult> {
  const errors: string[] = [];
  for (const model of opts.models) {
    if (opts.signal?.aborted) throw new GeminiError("aborted");
    try {
      return { text: await attempt(model, opts), model };
    } catch (e) {
      errors.push(`${model}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new GeminiError(`All Gemini models failed. ${errors.join(" | ")}`);
}

async function attempt(model: string, o: CallOpts): Promise<string> {
  const timeout = AbortSignal.timeout(o.timeoutMs);
  const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
  const body = {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [{ role: "user", parts: [{ text: o.prompt }] }],
    generationConfig: {
      maxOutputTokens: 32000,
      ...(o.schema ? { responseMimeType: "application/json", responseJsonSchema: o.schema } : {}),
    },
  };
  const res = await fetch(`${BASE}/${model}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }).catch((e) => {
    throw new Error(timeout.aborted ? `timed out after ${o.timeoutMs / 1000}s` : String(e));
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status} ${j?.error?.status ?? ""} ${(j?.error?.message ?? "").slice(0, 120)}`);
  }

  let text = "";
  let finish = "";
  let buf = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split(/\r?\n\r?\n/);
      buf = events.pop() ?? "";
      for (const ev of events) {
        const line = ev.split(/\r?\n/).find((l) => l.startsWith("data: "));
        if (!line) continue;
        const d = JSON.parse(line.slice(6));
        if (d.error) throw new Error(`stream error ${d.error.status ?? ""} ${d.error.message ?? ""}`);
        const cand = d.candidates?.[0];
        for (const p of cand?.content?.parts ?? []) if (p.text && !p.thought) text += p.text;
        if (cand?.finishReason) finish = cand.finishReason;
        o.onChunk?.(text.length);
      }
    }
  } catch (e) {
    throw new Error(timeout.aborted ? `timed out after ${o.timeoutMs / 1000}s` : e instanceof Error ? e.message : String(e));
  }
  if (finish && finish !== "STOP") throw new Error(`finished with ${finish}`);
  if (!text.trim()) throw new Error("empty response");
  return text;
}

export type UrlExtract = { url: string; text: string };

/**
 * Fallback reader for pages our plain fetch can't read (JavaScript-rendered docs):
 * Gemini's url_context tool retrieves the URLs and extracts the relevant facts.
 * Only URLs Gemini reports as successfully retrieved are kept, so made-up URLs
 * are still discarded. Output is a model extraction, not verbatim page text.
 */
export async function geminiReadUrls(urls: string[], focus: string, signal?: AbortSignal): Promise<{ extracts: UrlExtract[]; errors: string[] }> {
  // Small batches in parallel: big batches sometimes come back empty on the free tier.
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += 4) batches.push(urls.slice(i, i + 4));
  const results = await Promise.all(batches.map((b) => readUrlBatch(b, focus, signal)));
  return { extracts: results.flatMap((r) => r.extracts), errors: results.flatMap((r) => r.errors) };
}

async function readUrlBatch(urls: string[], focus: string, signal?: AbortSignal): Promise<{ extracts: UrlExtract[]; errors: string[] }> {
  const errors: string[] = [];
  if (!urls.length) return { extracts: [], errors };
  const prompt = `Read each URL below and extract every fact relevant to: ${focus}
Quote exact sentences where possible (in quotation marks). If a page does not exist or is irrelevant, write "NO RELEVANT CONTENT".
Format strictly: for each URL start a section with a line "### URL: <the exact url>" followed by the facts as bullet points.

${urls.join("\n")}`;
  for (const model of [WRITER_MODELS[0], ...FAST_MODELS]) {
    try {
      const timeout = AbortSignal.timeout(60_000);
      const res = await fetch(`${BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ url_context: {} }] }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const d = await res.json();
      if (!res.ok || d.error) {
        errors.push(`${model}: HTTP ${res.status} ${d?.error?.status ?? ""}`);
        continue;
      }
      const cand = d.candidates?.[0];
      const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
      const ok = new Set<string>(
        (cand?.urlContextMetadata?.urlMetadata ?? [])
          .filter((m: { urlRetrievalStatus?: string }) => m.urlRetrievalStatus === "URL_RETRIEVAL_STATUS_SUCCESS")
          .map((m: { retrievedUrl: string }) => norm(m.retrievedUrl)),
      );
      const text: string = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
      const out: UrlExtract[] = [];
      // Sections start at a heading/bold line containing a URL; tolerate markdown variants.
      const lines = text.split("\n");
      let cur: { url: string; body: string[] } | null = null;
      const flush = () => {
        if (!cur) return;
        const body = cur.body.join("\n").trim();
        const requested = urls.find((u) => norm(u) === norm(cur!.url));
        if (requested && ok.has(norm(requested)) && body && !/NO RELEVANT CONTENT/i.test(body.slice(0, 80)))
          out.push({ url: requested, text: body.slice(0, 6000) });
      };
      for (const line of lines) {
        const isHeading = /^\s*(#{1,6}|\*\*|\d+\.\s*\*\*)/.test(line) || /^\s*URL:/i.test(line);
        const url = line.match(/https:\/\/[^\s)\]>*`"]+/)?.[0];
        if (isHeading && url && urls.some((u) => norm(u) === norm(url))) {
          flush();
          cur = { url, body: [] };
        } else if (cur) cur.body.push(line);
      }
      flush();
      if (!out.length) {
        errors.push(`${model}: ${ok.size} retrieved, finish ${cand?.finishReason ?? "?"}, 0 sections parsed${text ? `; head: ${text.slice(0, 80).replace(/\n/g, " ")}` : ""}`);
        continue; // try the next model
      }
      return { extracts: out, errors };
    } catch (e) {
      errors.push(`${model}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { extracts: [], errors };
}
