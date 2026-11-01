// Composio-managed OAuth toolkits come from the app directory (src/data/directory.json), which is
// built from https://docs.composio.dev/toolkits/managed-auth. Used as a hint for the "managed
// alternative" section and to give the live agent the scopes Composio's own app requests.
import { findToolkit } from "./directory";

export function composioManagedMatch(name: string): string | null {
  const t = findToolkit(name);
  return t?.managed ? t.name : null;
}

/** Catalog facts to hand the live agent, or "" when the app isn't in the directory. */
export function directoryContext(query: string): string {
  const t = findToolkit(query);
  if (!t) return "";
  return [
    `Directory entry (Composio managed OAuth app catalog, ${t.managed ? "Composio-managed OAuth app available" : "bring your own OAuth app"}):`,
    `- name: ${t.name}; category: ${t.category}; auth methods: ${t.auth_schemes.join(", ")}`,
    t.description ? `- description: ${t.description}` : "",
    t.default_scopes ? `- scopes Composio's managed app requests by default (a hint of what an agent integration needs): ${t.default_scopes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
