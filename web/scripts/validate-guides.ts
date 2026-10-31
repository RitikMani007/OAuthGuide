// Validates every curated guide against the zod schema: `npx tsx scripts/validate-guides.ts`
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { Guide } from "../src/lib/schema";

const dir = path.join(process.cwd(), "src/data/guides");
let bad = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const g = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  const r = Guide.safeParse(g);
  const ids = new Set(g.sources?.map((s: { id: string }) => s.id));
  const dangling = (g.steps ?? []).flatMap((s: { source_ids: string[] }) => s.source_ids).filter((id: string) => !ids.has(id));
  if (!r.success || dangling.length || !g.meta) {
    bad++;
    console.log(`✗ ${f}`);
    if (!r.success) r.error.issues.slice(0, 8).forEach((i) => console.log(`   ${i.path.join(".")}: ${i.message}`));
    if (dangling.length) console.log(`   dangling source ids: ${dangling.join(", ")}`);
    if (!g.meta) console.log(`   missing meta`);
  } else console.log(`✓ ${f}`);
}
process.exit(bad ? 1 : 0);
