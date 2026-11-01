import type { AgentEvent } from "@/lib/agent";
import { generateGuide, activeProvider } from "@/lib/provider";
import { getGuide, slugify, saveChecked } from "@/lib/store";
import { verifyGuide } from "@/lib/verify";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST { query, force?, passcode? }      → research, write, save, then verify the new guide
 * POST { verify: slug, passcode? }        → re-run the verifier on an existing guide
 * Streams AgentEvents as SSE.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { query?: string; force?: boolean; passcode?: string; verify?: string };
  const q = (body.query ?? "").trim().slice(0, 120);
  const verifySlug = (body.verify ?? "").trim().slice(0, 80);
  if (!q && !verifySlug) return Response.json({ error: "Enter an app name or website." }, { status: 400 });
  if (process.env.DEMO_PASSCODE && body.passcode !== process.env.DEMO_PASSCODE)
    return Response.json({ error: "Live generation needs the demo passcode." }, { status: 401 });
  if (!activeProvider())
    return Response.json({ error: "Server has no model API key (GEMINI_API_KEY or ANTHROPIC_API_KEY)." }, { status: 500 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        let slug: string | null = null;
        if (verifySlug) {
          slug = verifySlug;
          if (!(await getGuide(slug))) throw new Error(`No guide "${slug}" to verify.`);
        } else {
          const existing = body.force ? null : await getGuide(slugify(q));
          if (existing) {
            send({ type: "phase", phase: "saving", message: `A guide for ${existing.name} already exists.` });
            send({ type: "guide", slug: existing.slug });
            slug = existing.meta.checks ? null : existing.slug; // verify it once if it never was
            if (!slug) send({ type: "phase", phase: "done", message: "Done." });
          } else {
            for await (const e of generateGuide(q, req.signal)) {
              send(e);
              if (e.type === "guide") slug = e.slug;
            }
          }
        }
        if (slug) {
          const guide = await getGuide(slug);
          if (!guide) throw new Error("Guide vanished before verification.");
          send({ type: "phase", phase: "verify", message: `Verifying the ${guide.name} guide: re-fetching sources, probing endpoints, checking claims…` });
          // A guide that already carries an independent (agent-reviewed) verification keeps it; every other guide gets the model re-check.
          const claims = !guide.meta.verification || guide.meta.verification.kind === "automated";
          const it = verifyGuide(guide, { claims, signal: req.signal });
          let next = await it.next();
          while (!next.done) {
            send(next.value);
            next = await it.next();
          }
          const verified = next.value;
          const where = await saveChecked(verified);
          send({
            type: "verified",
            summary: verified.meta.checks!.summary,
            claims: verified.meta.verification?.kind === "automated" ? verified.meta.verification.findings.length : 0,
            applied: verified.meta.checks!.applied.length,
          });
          send({ type: "phase", phase: "done", message: where === "skipped" ? "Checks finished (curated guide; results are not stored in production)." : "Verified and saved." });
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
