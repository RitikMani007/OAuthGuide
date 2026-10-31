import Link from "next/link";
import { curated } from "@/data/guides";
import { EvidenceBadge, OwnerBadge } from "@/components/badges";

export const metadata = { title: "Method & evidence · OAuth Runway" };

export default function MethodPage() {
  const rows = curated
    .filter((g) => g.meta.verification)
    .map((g) => {
      const f = g.meta.verification!.findings;
      return {
        slug: g.slug,
        name: g.name,
        confirmed: f.filter((x) => x.result === "confirmed").length,
        corrected: f.filter((x) => x.result === "corrected").length,
        unverified: f.filter((x) => x.result === "unverified").length,
        corrections: f.filter((x) => x.result === "corrected"),
      };
    });
  const tot = rows.reduce((a, r) => ({ c: a.c + r.confirmed, x: a.x + r.corrected, u: a.u + r.unverified }), { c: 0, x: 0, u: 0 });

  return (
    <div className="space-y-10 max-w-3xl">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Method &amp; evidence</h1>
        <p className="text-stone-700">
          How the guides are made, what we actually tested, and where you should be skeptical.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">The problem we focused on</h2>
        <p className="text-stone-700 text-[15px] leading-relaxed">
          Registering an OAuth app rarely takes long. The real uncertainty is <b>everything between &ldquo;it works for me&rdquo; and
          &ldquo;any customer can connect&rdquo;</b>: test-user caps, unverified-app warnings, install limits, scope tiers that trigger
          security assessments, partner programs, and review queues measured in weeks. That variance decides whether a
          developer can launch next week, so every guide leads with a verdict (difficulty, hands-on time, calendar time,
          approval type, and the single most likely blocker). It then lays out the ladder from test app to production and
          splits each step into work an agent can do and work only you can do.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Evidence labels</h2>
        <ul className="space-y-2 text-sm">
          <li className="flex gap-3"><EvidenceBadge e="tested" /> Confirmed by a live probe of the provider&apos;s endpoints, such as a discovery document or the authorize endpoint&apos;s response to an unknown client, or by a hands-on attempt.</li>
          <li className="flex gap-3"><EvidenceBadge e="sourced" /> Stated in a cited source, usually official developer documentation. Community sources are labeled as such.</li>
          <li className="flex gap-3"><EvidenceBadge e="inferred" /> Reasoned from indirect evidence. Treat it as a hypothesis to check.</li>
        </ul>
        <p className="text-sm text-stone-600">Every step, blocker, review section and verdict carries one of these labels, and each guide shows its overall evidence mix.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">How guides are produced</h2>
        <ol className="list-decimal pl-5 space-y-2 text-[15px] text-stone-700">
          <li><b>Research agent.</b> It searches developer documentation, reads the relevant pages, and writes a dossier where every fact carries a URL.</li>
          <li><b>Live probing.</b> The agent has a narrow <code className="text-xs bg-stone-100 px-1 rounded">http_probe</code> tool: HTTPS GET to public hosts only, no redirects followed, and a capped response size. It uses this to fetch OAuth/OIDC discovery documents and to hit authorize endpoints with a dummy client. A probe is how a claim earns the &ldquo;tested&rdquo; label without anyone logging in.</li>
          <li><b>Structured synthesis.</b> A second model call converts the dossier into a guide using a strict JSON schema with structured outputs. It may not raise a claim&apos;s evidence label above what the dossier supports.</li>
          <li><b>Independent verification</b> (curated guides only). A separate agent that didn&apos;t write the draft re-checks 6–8 high-impact claims per guide against primary sources and the probe log. It corrects errors in place and logs every check.</li>
        </ol>
        <p className="text-sm text-stone-600">
          Live guides generated from the search box go through steps 1–3 and are marked &ldquo;agent-generated, not hand-reviewed&rdquo;.
          The agent&apos;s raw research notes are attached to each generated guide so anyone can audit it.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Verification results</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-stone-600">Verification logs are not loaded yet.</p>
        ) : (
          <>
            <p className="text-sm text-stone-600">
              {tot.c + tot.x + tot.u} high-impact claims re-checked across {rows.length} curated guides: <b className="text-emerald-700">{tot.c} confirmed</b>,{" "}
              <b className="text-amber-700">{tot.x} corrected</b>, <b className="text-stone-700">{tot.u} could not be verified</b>.
            </p>
            <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs text-stone-500">
                  <tr><th className="p-2.5">Guide</th><th className="p-2.5">Confirmed</th><th className="p-2.5">Corrected</th><th className="p-2.5">Unverified</th></tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((r) => (
                    <tr key={r.slug}>
                      <td className="p-2.5"><Link className="text-indigo-700 hover:underline" href={`/guides/${r.slug}`}>{r.name}</Link></td>
                      <td className="p-2.5">{r.confirmed}</td>
                      <td className="p-2.5">{r.corrected}</td>
                      <td className="p-2.5">{r.unverified}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">What verification corrected</div>
              <ul className="text-sm space-y-2">
                {rows.flatMap((r) =>
                  r.corrections.map((c, i) => (
                    <li key={r.slug + i} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                      <span className="font-medium">{r.name}:</span> {c.claim}
                      <div className="text-stone-700 mt-1">{c.note}</div>
                    </li>
                  )),
                )}
              </ul>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Who does what</h2>
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-stone-200 bg-white p-3"><OwnerBadge o="agent" /><p className="mt-2 text-stone-700">Research, scope minimization, redirect URI lists, app manifests, privacy policy and scope justification drafts, demo video scripts, test calls with tokens you provide.</p></div>
          <div className="rounded-lg border border-stone-200 bg-white p-3"><OwnerBadge o="you" /><p className="mt-2 text-stone-700">Logging in, accepting terms, verifying domains and businesses, payment, recording the demo, legal sign-off, and answering reviewers.</p></div>
          <div className="rounded-lg border border-stone-200 bg-white p-3"><OwnerBadge o="wait" /><p className="mt-2 text-stone-700">Provider review queues and security assessments. These are calendar time you can plan around but can&apos;t shorten.</p></div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Limitations</h2>
        <ul className="list-disc pl-5 space-y-1.5 text-sm text-stone-700">
          <li>No agent logged into a provider console for these guides. Console menu paths come from documentation and may drift after UI changes. A probe can confirm that endpoints exist and how they respond, but it can&apos;t confirm a review timeline.</li>
          <li>Review durations are mostly provider estimates or community reports. Real-world times vary with scope, completeness and reviewer load.</li>
          <li>Live-generated guides depend on what the agent finds within a few minutes. Niche providers with thin public docs will have more &ldquo;inferred&rdquo; claims.</li>
          <li>Policies change. Each guide is dated, and the sources are linked so you can re-check them.</li>
        </ul>
      </section>
    </div>
  );
}
