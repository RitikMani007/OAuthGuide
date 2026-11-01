// Promotes a verified generated guide into the curated set that ships with the repo.
//   npm run promote -- <slug> [--base https://oauthguide-psi.vercel.app] [--force]
// The guide must be "Verified" by the same rules every guide is judged by (src/lib/trust.ts):
// checks ran, none failed, key claims re-checked, more confirmed than unverified.
// --force promotes anyway and records that the rules were overridden.
import { writeFileSync, existsSync } from "fs";
import path from "path";
import { execSync } from "child_process";
import { Guide, type StoredGuide } from "../src/lib/schema";
import { guideTrust } from "../src/lib/trust";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const base = (args[args.indexOf("--base") + 1] && args.includes("--base") ? args[args.indexOf("--base") + 1] : process.env.BASE_URL ?? "https://oauthguide-psi.vercel.app").replace(/\/$/, "");
const force = args.includes("--force");
if (!slug) {
  console.error("usage: npm run promote -- <slug> [--base URL] [--force]");
  process.exit(2);
}

async function main() {
  const res = await fetch(`${base}/api/guides/${slug}`);
  if (!res.ok) {
    console.error(`✗ ${base}/api/guides/${slug} → HTTP ${res.status}`);
    process.exit(1);
  }
  const g = (await res.json()) as StoredGuide;
  const parsed = Guide.safeParse(g);
  if (!parsed.success) {
    console.error("✗ guide does not match the schema:");
    parsed.error.issues.slice(0, 8).forEach((i) => console.error(`   ${i.path.join(".")}: ${i.message}`));
    process.exit(1);
  }
  const trust = guideTrust(g);
  console.log(`${g.name} (${g.slug}) is ${trust.level.toUpperCase()}`);
  for (const r of trust.rules) console.log(`  ${r.ok ? "✓" : "✗"} ${r.label}: ${r.detail}`);
  if (trust.level !== "verified" && !force) {
    console.error("\n✗ Not promoted: every rule must pass. Fix the guide or re-run its checks, or pass --force to override.");
    process.exit(1);
  }

  const file = path.join(process.cwd(), "src/data/guides", `${g.slug}.json`);
  if (existsSync(file) && !force) {
    console.error(`\n✗ ${file} already exists; pass --force to replace it.`);
    process.exit(1);
  }
  const promoted: StoredGuide = {
    ...g,
    meta: {
      ...g.meta,
      origin: "curated",
      dossier: undefined,
      promoted: { date: new Date().toISOString().slice(0, 10), from: base, forced: force || undefined },
    },
  };
  writeFileSync(file, JSON.stringify(promoted, null, 2) + "\n");
  execSync("node scripts/index-guides.mjs", { stdio: "inherit" });
  console.log(`\n✓ Wrote ${path.relative(process.cwd(), file)} and re-indexed the curated set.`);
  console.log(`  Review the diff, then: git add -A && git commit -m "Promote ${g.name} guide to the curated set"`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
