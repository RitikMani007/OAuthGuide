import { listCurated, listGenerated } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Library summaries as JSON, for agents and for the backfill script. */
export async function GET() {
  const curated = listCurated();
  const generated = (await listGenerated()).filter((g) => !curated.some((c) => c.slug === g.slug));
  return Response.json({ count: curated.length + generated.length, guides: [...curated, ...generated] });
}
