import { Suspense } from "react";
import { LiveGenerator } from "@/components/live-generator";

export const metadata = { title: "Investigating… · OAuth Runway" };
export const dynamic = "force-dynamic";

export default function GeneratePage() {
  return (
    <Suspense>
      <LiveGenerator needsPasscode={!!process.env.DEMO_PASSCODE} />
    </Suspense>
  );
}
