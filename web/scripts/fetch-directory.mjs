// Builds src/data/directory.json: every OAuth-capable toolkit in Composio's managed OAuth app
// directory (https://docs.composio.dev/toolkits/managed-auth). The docs page loads
// /data/toolkits.json client-side; this script reads the same file and keeps the OAuth ones.
//   node scripts/fetch-directory.mjs
import { writeFileSync } from "fs";
import path from "path";

const SOURCE = "https://docs.composio.dev/data/toolkits.json";
const PAGE = "https://docs.composio.dev/toolkits/managed-auth";

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE} -> ${res.status}`);
const all = await res.json();

const isOAuth = (s) => typeof s === "string" && s.toUpperCase().includes("OAUTH");
const clip = (s, n) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

const toolkits = all
  .filter((t) => (t.authSchemes ?? []).some(isOAuth))
  .map((t) => {
    const oauthCfg = (t.authConfigDetails ?? []).find((c) => isOAuth(c.mode));
    const opt = oauthCfg?.fields?.auth_config_creation?.optional ?? [];
    const scopes = opt.find((f) => f.name === "scopes")?.default ?? "";
    return {
      slug: t.slug,
      name: clip(t.name, 60),
      logo: t.logo ?? null,
      category: t.category ?? "other",
      description: clip(t.description, 220),
      auth_schemes: t.authSchemes ?? [],
      managed: (t.composioManagedAuthSchemes ?? []).some(isOAuth),
      // Scopes Composio's own OAuth app requests by default: a hint for what an agent integration needs.
      default_scopes: clip(scopes, 600),
      tool_count: t.toolCount ?? 0,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const out = { source: PAGE, data_url: SOURCE, fetched_at: new Date().toISOString().slice(0, 10), toolkits };
const file = path.join(process.cwd(), "src/data/directory.json");
writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${toolkits.length} OAuth toolkits (${toolkits.filter((t) => t.managed).length} Composio-managed) to ${file}`);
