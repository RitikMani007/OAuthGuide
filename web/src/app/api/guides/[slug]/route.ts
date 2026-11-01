import { getGuide } from "@/lib/store";

export const dynamic = "force-dynamic";

/** One full guide as JSON (used by scripts/promote-guide.ts and by agents). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const g = await getGuide(slug.slice(0, 80));
  if (!g) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(g);
}
