import "server-only";
import { lookup } from "dns/promises";
import net from "net";

// A deliberately narrow HTTP probe the agent can use to *test* OAuth facts
// instead of only reading about them: fetch an OIDC/OAuth discovery document,
// or hit an authorize endpoint with a dummy client_id to see that it exists and
// how it rejects unknown clients. HTTPS only, public hosts only, GET only,
// no redirects followed, small body cap.

const MAX_BODY = 6000;

function isPrivate(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

export type ProbeResult = {
  url: string;
  status?: number;
  location?: string | null;
  content_type?: string | null;
  body_excerpt?: string;
  error?: string;
};

/** Returns an error string if the URL is not a public https URL, else null. */
export async function checkPublicHttps(rawUrl: string): Promise<{ url?: URL; error?: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: "invalid URL" };
  }
  if (url.protocol !== "https:") return { error: "only https URLs are allowed" };
  try {
    const { address } = await lookup(url.hostname);
    if (isPrivate(address)) return { error: "host resolves to a private address" };
  } catch {
    return { error: "DNS lookup failed" };
  }
  return { url };
}

export async function httpProbe(rawUrl: string): Promise<ProbeResult> {
  const { url, error } = await checkPublicHttps(rawUrl);
  if (!url) return { url: rawUrl, error };
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "oauth-guide-agent/1.0 (+research probe)", accept: "application/json, text/html;q=0.8" },
    });
    const text = await res.text();
    return {
      url: rawUrl,
      status: res.status,
      location: res.headers.get("location"),
      content_type: res.headers.get("content-type"),
      body_excerpt: text.replace(/\s+/g, " ").slice(0, MAX_BODY),
    };
  } catch (e) {
    return { url: rawUrl, error: e instanceof Error ? e.message : String(e) };
  }
}
