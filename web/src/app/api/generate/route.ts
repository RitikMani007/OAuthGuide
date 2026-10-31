import { generateGuide, type AgentEvent } from "@/lib/agent";
import { getGuide, slugify } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { query, force, passcode } = (await req.json().catch(() => ({}))) as {
    query?: string;
    force?: boolean;
    passcode?: string;
  };
  const q = (query ?? "").trim().slice(0, 120);
  if (!q) return Response.json({ error: "Enter an app name or website." }, { status: 400 });
  if (process.env.DEMO_PASSCODE && passcode !== process.env.DEMO_PASSCODE)
    return Response.json({ error: "Live generation needs the demo passcode." }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "Server is missing ANTHROPIC_API_KEY." }, { status: 500 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        const existing = force ? null : await getGuide(slugify(q));
        if (existing) {
          send({ type: "phase", phase: "done", message: `A guide for ${existing.name} already exists.` });
          send({ type: "guide", slug: existing.slug });
        } else {
          for await (const e of generateGuide(q, req.signal)) send(e);
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}
