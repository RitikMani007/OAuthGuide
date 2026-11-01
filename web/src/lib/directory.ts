// The app directory: every OAuth-capable toolkit in Composio's managed OAuth app catalog
// (https://docs.composio.dev/toolkits/managed-auth), refreshed with scripts/fetch-directory.mjs.
import data from "@/data/directory.json";

export type DirectoryEntry = {
  slug: string;
  name: string;
  logo: string | null;
  category: string;
  description: string;
  auth_schemes: string[];
  managed: boolean;
  default_scopes: string;
  tool_count: number;
};

export const DIRECTORY = data.toolkits as DirectoryEntry[];
export const DIRECTORY_META = { source: data.source, fetched_at: data.fetched_at };

/** "Google Calendar", "google-calendar", "googlecalendar", "calendar.google.com" all collapse to comparable keys. */
export const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function hostOf(input: string): string | null {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(?:[/?#]|$)/i);
  return m ? m[1].toLowerCase() : null;
}

const bySlug = new Map(DIRECTORY.map((t) => [normKey(t.slug), t]));
const byName = new Map(DIRECTORY.map((t) => [normKey(t.name), t]));

/** Exact match on slug or name, or on a website's second-level domain (e.g. "app.asana.com" → asana). */
export function findToolkit(query: string): DirectoryEntry | null {
  const q = query.trim();
  if (!q) return null;
  const k = normKey(q);
  const direct = bySlug.get(k) ?? byName.get(k);
  if (direct) return direct;
  const host = hostOf(q);
  if (host) {
    const parts = host.split(".");
    // try "calendar.google" → googlecalendar, then "asana"
    const candidates = [parts.slice(0, -1).reverse().join(""), parts.slice(0, -1).join(""), parts[parts.length - 2]];
    for (const c of candidates) {
      const hit = bySlug.get(normKey(c)) ?? byName.get(normKey(c));
      if (hit) return hit;
    }
  }
  return null;
}

/** Logo for a guide: the directory's logo when the app is listed, otherwise the site's favicon. */
export function resolveLogo(opts: { name: string; website?: string | null; query?: string }): string | null {
  const hit = findToolkit(opts.name) ?? (opts.query ? findToolkit(opts.query) : null) ?? (opts.website ? findToolkit(opts.website) : null);
  if (hit?.logo) return hit.logo;
  const host = (opts.website && hostOf(opts.website)) ?? (opts.query && hostOf(opts.query)) ?? null;
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128` : null;
}

export function searchDirectory(q: string, limit = 8): DirectoryEntry[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const k = normKey(s);
  return DIRECTORY.filter((t) => t.name.toLowerCase().includes(s) || t.slug.includes(k))
    .sort((a, b) => Number(normKey(b.name).startsWith(k)) - Number(normKey(a.name).startsWith(k)) || a.name.localeCompare(b.name))
    .slice(0, limit);
}
