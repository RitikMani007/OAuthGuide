import { Suspense } from "react";
import { LiveGenerator } from "@/components/live-generator";
import { findToolkit, resolveLogo } from "@/lib/directory";

export const metadata = { title: "Investigating… · OAuth Runway" };
export const dynamic = "force-dynamic";

export default async function GeneratePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q ?? "";
  const hit = findToolkit(q);
  const app = q
    ? { name: hit?.name ?? q, logo: hit?.logo ?? resolveLogo({ name: q, query: q }), managed: hit?.managed ?? null, inDirectory: !!hit }
    : null;
  return (
    <Suspense>
      <LiveGenerator needsPasscode={!!process.env.DEMO_PASSCODE} app={app} />
    </Suspense>
  );
}
