import { Suspense } from "react";
import { LiveGenerator } from "@/components/live-generator";
import { findToolkit, resolveLogo } from "@/lib/directory";
import { getGuide } from "@/lib/store";

export const metadata = { title: "Investigating… · OAuth Runway" };
export const dynamic = "force-dynamic";

export default async function GeneratePage({ searchParams }: { searchParams: Promise<{ q?: string; verify?: string }> }) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const verify = sp.verify ?? "";
  let app = null;
  if (verify) {
    const g = await getGuide(verify);
    if (g) app = { name: g.name, logo: g.meta.logo ?? resolveLogo({ name: g.name, website: g.website }), managed: g.managed_alternative.composio_managed, inDirectory: !!findToolkit(g.name) };
  } else if (q) {
    const hit = findToolkit(q);
    app = { name: hit?.name ?? q, logo: hit?.logo ?? resolveLogo({ name: q, query: q }), managed: hit?.managed ?? null, inDirectory: !!hit };
  }
  return (
    <Suspense>
      <LiveGenerator needsPasscode={!!process.env.DEMO_PASSCODE} app={app} />
    </Suspense>
  );
}
