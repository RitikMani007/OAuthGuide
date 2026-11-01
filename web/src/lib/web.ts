import "server-only";
import { checkPublicHttps } from "./probe";

// Keyless web search + page reading for providers without built-in web tools.

export type SearchResult = { title: string; url: string; snippet: string };

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function unwrapDdg(href: string): string | null {
  const m = href.match(/uddg=([^&]+)/);
  const url = m ? decodeURIComponent(m[1]) : href.startsWith("http") ? href : null;
  if (!url || /duckduckgo\.com\/y\.js|\/\/duckduckgo\.com\/l\/\?.*ad_/.test(url)) return null;
  return url;
}

async function ddgHtml(q: string): Promise<SearchResult[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(10000),
  });
  const html = await res.text();
  const out: SearchResult[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  for (const m of html.matchAll(re)) {
    const url = unwrapDdg(m[1].replace(/&amp;/g, "&"));
    if (url) out.push({ url, title: decode(m[2]), snippet: decode(m[3] ?? "") });
  }
  return out;
}

async function ddgLite(q: string): Promise<SearchResult[]> {
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(10000),
  });
  const html = await res.text();
  const out: SearchResult[] = [];
  const links = [...html.matchAll(/<a[^>]+href="([^"]*uddg=[^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>|<a[^>]+class=['"]result-link['"][^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)].map((m) => decode(m[1]));
  links.forEach((m, i) => {
    const url = unwrapDdg((m[1] ?? m[3] ?? "").replace(/&amp;/g, "&"));
    if (url) out.push({ url, title: decode(m[2] ?? m[4] ?? ""), snippet: snippets[i] ?? "" });
  });
  if (out.length) return out;
  // Markup fallback: any uddg link.
  for (const m of html.matchAll(/href="([^"]*uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = unwrapDdg(m[1].replace(/&amp;/g, "&"));
    if (url) out.push({ url, title: decode(m[2]), snippet: "" });
  }
  return out;
}

/** Runs queries one at a time (bursts get bot-challenged); stops early if search is blocked. */
export async function searchAll(queries: string[], limit = 8): Promise<SearchResult[][]> {
  const out: SearchResult[][] = [];
  for (const q of queries) {
    const r = await webSearch(q, limit);
    out.push(r);
    if (!r.length && out.length === 1) break;
    await new Promise((res) => setTimeout(res, 350));
  }
  return out;
}

export async function webSearch(q: string, limit = 8): Promise<SearchResult[]> {
  for (const engine of [ddgHtml, ddgLite]) {
    try {
      const r = await engine(q);
      if (r.length) {
        const seen = new Set<string>();
        return r.filter((x) => !seen.has(x.url) && seen.add(x.url)).slice(0, limit);
      }
    } catch {}
  }
  return [];
}

export type Page = { url: string; title: string; text: string; links: { url: string; text: string }[]; error?: string; /** size of the raw HTML, to spot single-page apps whose text is a shell */ html_chars?: number };

/** Fetch a public https page and reduce it to readable text. */
export async function readPage(rawUrl: string, maxChars = 9000): Promise<Page> {
  let current = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    const { url, error } = await checkPublicHttps(current);
    if (!url) return { url: rawUrl, title: "", text: "", links: [], error };
    try {
      const res = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
        signal: AbortSignal.timeout(12000),
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, url).toString();
        continue;
      }
      if (!res.ok) return { url: current, title: "", text: "", links: [], error: `HTTP ${res.status}` };
      const type = res.headers.get("content-type") ?? "";
      const body = (await res.text()).slice(0, 1_500_000);
      if (!/html|text|json|xml/.test(type)) return { url: current, title: "", text: "", links: [], error: `unsupported content-type ${type}` };
      const title = decode(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
      const text = htmlToText(body).slice(0, maxChars);
      const links = extractLinks(body, url);
      return { url: current, title, text, links, html_chars: body.length, error: text.length < 200 ? "page had little readable text (may need JavaScript)" : undefined };
    } catch (e) {
      return { url: current, title: "", text: "", links: [], error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { url: rawUrl, title: "", text: "", links: [], error: "too many redirects" };
}

/** Same-site https links (no assets/anchors), with their anchor text. */
function extractLinks(html: string, base: URL): { url: string; text: string }[] {
  const site = base.hostname.split(".").slice(-2).join(".");
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<a[^>]+href="([^"#]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, "&"), base);
      if (u.protocol !== "https:" || !u.hostname.endsWith(site)) continue;
      if (/\.(png|jpe?g|gif|svg|css|js|pdf|zip|ico|webp)$/i.test(u.pathname)) continue;
      u.hash = "";
      const key = u.toString();
      const text = decode(m[2]).slice(0, 80);
      if (!out.has(key) && text) out.set(key, text);
    } catch {}
  }
  return [...out].map(([url, text]) => ({ url, text })).slice(0, 400);
}

function htmlToText(html: string): string {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
  return main
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|pre|br)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<h([1-6])[^>]*>/gi, "\n\n## ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}
