// Runs the post-generation verifier over guides that have not been checked yet.
//   node scripts/backfill-checks.mjs [--base http://localhost:3000] [--all] [--only slug,slug] [--dry-run]
// Against a dev server, curated guides are written back to src/data/guides so the results ship
// with the build. Against production, only generated guides (in Blob) are updated.
// Reads DEMO_PASSCODE from the environment (or .env.local) when the server requires one.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = (opt("--base", process.env.BASE_URL ?? "http://localhost:3000")).replace(/\/$/, "");
const all = args.includes("--all");
const dry = args.includes("--dry-run");
const only = (opt("--only", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const verbose = args.includes("--verbose");

let passcode = process.env.DEMO_PASSCODE;
if (!passcode) {
  try {
    passcode = readFileSync(".env.local", "utf8").match(/^DEMO_PASSCODE=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
  } catch {
    /* no .env.local */
  }
}

const { guides } = await (await fetch(`${base}/api/guides`)).json();
const todo = guides.filter((g) => (only.length ? only.includes(g.slug) : all || !g.stats.checks));
console.log(`${guides.length} guides in the library; ${todo.length} to check (${dry ? "dry run" : base}).`);

let failures = 0;
for (const g of todo) {
  process.stdout.write(`\n▶ ${g.name} (${g.slug}, ${g.origin})`);
  if (dry) continue;
  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verify: g.slug, passcode }),
  });
  if (!res.ok || !res.body) {
    failures++;
    console.log(`\n  ✗ HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/^data: /, "");
      buf = buf.slice(nl + 2);
      if (!line) continue;
      const e = JSON.parse(line);
      if (e.type === "check") process.stdout.write(e.result.status === "pass" ? "." : e.result.status === "warn" ? "!" : e.result.status === "fail" ? "✕" : "-");
      else if (e.type === "claim") process.stdout.write(e.finding.result === "confirmed" ? "✓" : e.finding.result === "corrected" ? "✎" : "?");
      else if (e.type === "verified") console.log(`\n  ${e.summary.pass} pass · ${e.summary.warn} warn · ${e.summary.fail} fail · ${e.summary.skip} skip · ${e.claims} claims re-checked · ${e.applied} edits applied`);
      else if (e.type === "error") {
        failures++;
        console.log(`\n  ✗ ${e.message}`);
      } else if (e.type === "phase" && e.phase === "done") console.log(`  ${e.message}`);
      else if (verbose && e.type === "note") console.log(`\n  · ${e.text.trim()}`);
    }
  }
}
console.log(`\nDone. ${todo.length - failures}/${todo.length} succeeded.`);
process.exit(failures ? 1 : 0);
