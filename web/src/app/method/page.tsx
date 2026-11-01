import Link from "next/link";
import { listCurated, listGenerated } from "@/lib/store";
import { DIRECTORY, DIRECTORY_META, normKey } from "@/lib/directory";
import { EvidenceBadge, OwnerBadge, TrustBadge } from "@/components/badges";
import { AppLogo } from "@/components/app-logo";

export const metadata = { title: "Method & evidence · OAuth Runway" };
// Numbers on this page are computed from the live library on every request, so they stay
// correct as curated and generated guides are added.
export const dynamic = "force-dynamic";

export default async function MethodPage() {
  const curatedList = listCurated();
  const generatedList = (await listGenerated()).filter((g) => !curatedList.some((c) => c.slug === g.slug));
  const library = [...curatedList, ...generatedList].sort((a, b) => a.verdict.difficulty - b.verdict.difficulty || a.name.localeCompare(b.name));
  const keys = new Set(library.flatMap((g) => [normKey(g.slug), normKey(g.name)]));
  const covered = DIRECTORY.filter((t) => keys.has(normKey(t.slug)) || keys.has(normKey(t.name))).length;
  const sum = (f: (g: (typeof library)[number]) => number) => library.reduce((a, g) => a + f(g), 0);
  const ev = { tested: sum((g) => g.stats.tested), sourced: sum((g) => g.stats.sourced), inferred: sum((g) => g.stats.inferred) };
  const evTotal = ev.tested + ev.sourced + ev.inferred || 1;
  const own = { agent: sum((g) => g.stats.agent), you: sum((g) => g.stats.you), wait: sum((g) => g.stats.wait) };
  const ownTotal = own.agent + own.you + own.wait || 1;
  const probes = sum((g) => g.stats.probes);
  const sources = sum((g) => g.stats.sources);
  const byLabel = ["Instant", "Easy", "Moderate", "Hard", "Gated"].map((l) => ({ label: l, n: library.filter((g) => g.verdict.label === l).length }));
  const pct = (n: number, d: number) => `${Math.round((n / d) * 100)}%`;

  const rows = library
    .filter((g) => g.stats.verification)
    .map((g) => ({ slug: g.slug, name: g.name, kind: g.stats.verification_kind, ...g.stats.verification!, findings: g.findings }));
  const tot = rows.reduce((a, r) => ({ c: a.c + r.confirmed, x: a.x + r.corrected, u: a.u + r.unverified }), { c: 0, x: 0, u: 0 });
  const byTrust = { verified: library.filter((g) => g.stats.trust.level === "verified").length, checked: library.filter((g) => g.stats.trust.level === "checked").length, unchecked: library.filter((g) => g.stats.trust.level === "unchecked").length };

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
          <li><b>Plan.</b> The model identifies the product and its developer-docs site. It proposes the official pages most likely to answer the key questions (app creation, OAuth flow, scopes, review and publishing, limits), plus endpoints to probe.</li>
          <li><b>Read and follow links.</b> Code fetches those pages and drops any that don&apos;t exist, so made-up URLs are never cited. It then collects on-topic links from the pages it read. The model picks the most useful ones over up to two rounds. Pages that only render with JavaScript are read through Gemini&apos;s URL reader, and only URLs the reader actually retrieved are kept.</li>
          <li><b>Live probing.</b> A narrow <code className="text-xs bg-stone-100 px-1 rounded">http_probe</code> (HTTPS GET to public hosts only, no redirects followed, capped response size) fetches OAuth/OIDC discovery documents and hits authorize endpoints with a dummy client. A probe is how a claim earns the &ldquo;tested&rdquo; label without anyone logging in.</li>
          <li><b>Structured synthesis.</b> One schema-constrained model call turns the research notes into a guide. Code then enforces the evidence rules: a claim can only be &ldquo;tested&rdquo; if it cites a probe, and &ldquo;sourced&rdquo; without a resolvable citation becomes &ldquo;inferred&rdquo;.</li>
          <li><b>Automated verification</b> (every generated guide, right after it is saved). Code re-fetches every cited source and downgrades claims whose sources are gone, re-probes the authorize, token and discovery endpoints the guide names, applies consistency rules (label vs difficulty, approval vs calendar time, step coverage, citations), cross-checks Composio&apos;s catalog for the managed-app flag and default scopes, and smoke-tests the exports. Then a second model that did not write the guide re-checks its five to seven highest-impact claims against freshly fetched page text and either confirms, corrects or marks them unverified. Corrections are applied in place and listed on the guide.</li>
          <li><b>Independent verification</b> (curated guides). A separate agent that didn&apos;t write the draft re-checks the highest-impact claims per guide against primary sources and the probe log. It corrects errors in place and logs every check. Live-generated guides get the automated version of this (step 5).</li>
        </ol>
        <p className="text-sm text-stone-600">
          Every guide, curated or generated, gets the same status from the same four rules: the automated checks ran, none failed, a second pass re-checked the key claims, and at least two claims were settled (confirmed, or corrected in place against a source) with more settled than left unverified. All four met is <b>Verified</b>; checks ran but a rule is unmet is <b>Checked</b>; otherwise <b>Unchecked</b>. A verified generated guide can be promoted into the curated set with <code className="text-xs bg-stone-100 px-1 rounded">npm run promote -- &lt;slug&gt;</code>, which applies the same rules and records the promotion on the guide.
          The agent&apos;s full research notes (every page excerpt and probe response) are attached to each generated guide so
          anyone can audit it. The live demo runs on Gemini&apos;s free tier. The same pipeline can run on Claude, with built-in
          web search, by setting <code className="text-xs bg-stone-100 px-1 rounded">ANTHROPIC_API_KEY</code>.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Library status &amp; verification</h2>
        <p className="text-sm text-stone-600">
          Computed from every guide at the moment you load this page: {curatedList.length} curated and {generatedList.length} agent-generated.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Guides" value={String(library.length)} sub={`${curatedList.length} curated · ${generatedList.length} generated`} />
          <Stat label="Directory coverage" value={`${covered} / ${DIRECTORY.length}`} sub={`OAuth apps in Composio's catalog (${DIRECTORY_META.fetched_at})`} />
          <Stat label="Live probes cited" value={String(probes)} sub="no-credential endpoint checks" />
          <Stat label="Sources cited" value={String(sources)} sub="official docs, community, probes" />
        </div>

        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-2">
            <div className="font-medium">Evidence mix across all guides</div>
            <Bar parts={[
              { n: ev.tested, cls: "bg-emerald-500", label: "tested" },
              { n: ev.sourced, cls: "bg-sky-500", label: "sourced" },
              { n: ev.inferred, cls: "bg-stone-300", label: "inferred" },
            ]} total={evTotal} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
              <span><EvidenceBadge e="tested" /> {ev.tested} ({pct(ev.tested, evTotal)})</span>
              <span><EvidenceBadge e="sourced" /> {ev.sourced} ({pct(ev.sourced, evTotal)})</span>
              <span><EvidenceBadge e="inferred" /> {ev.inferred} ({pct(ev.inferred, evTotal)})</span>
            </div>
            <p className="text-xs text-stone-500">Counted over verdicts, review sections, steps and blockers.</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-2">
            <div className="font-medium">Who does the steps</div>
            <Bar parts={[
              { n: own.agent, cls: "bg-indigo-500", label: "agent" },
              { n: own.you, cls: "bg-stone-800", label: "you" },
              { n: own.wait, cls: "bg-amber-400", label: "wait" },
            ]} total={ownTotal} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
              <span><OwnerBadge o="agent" /> {own.agent} ({pct(own.agent, ownTotal)})</span>
              <span><OwnerBadge o="you" /> {own.you} ({pct(own.you, ownTotal)})</span>
              <span><OwnerBadge o="wait" /> {own.wait} ({pct(own.wait, ownTotal)})</span>
            </div>
            <p className="text-xs text-stone-500">
              Difficulty spread: {byLabel.filter((b) => b.n).map((b) => `${b.n} ${b.label}`).join(" · ") || "none yet"}.
            </p>
          </div>
        </div>

        <p className="text-sm text-stone-600">
          {tot.c + tot.x + tot.u > 0 ? (
            <>
              {tot.c + tot.x + tot.u} high-impact claims re-checked across {rows.length} guide{rows.length === 1 ? "" : "s"} ({rows.filter((r) => r.kind === "independent").length} by an independent agent, {rows.filter((r) => r.kind === "automated").length} by the automated verifier):{" "}
              <b className="text-emerald-700">{tot.c} confirmed</b>, <b className="text-amber-700">{tot.x} corrected</b>, <b className="text-stone-700">{tot.u} could not be verified</b>.
            </>
          ) : (
            "No verification records yet."
          )}
        </p>
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-stone-500">
              <tr>
                <th className="p-2.5">Guide</th>
                <th className="p-2.5">Status</th>
                <th className="p-2.5">Verdict</th>
                <th className="p-2.5" title="steps an agent can do / you do / wait">Agent · you · wait</th>
                <th className="p-2.5" title="tested / sourced / inferred">Evidence</th>
                <th className="p-2.5" title="automated checks: pass / warn / fail">Checks</th>
                <th className="p-2.5" title="claims re-checked: confirmed / corrected / unverified">Claims</th>
                <th className="p-2.5">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {library.map((g) => (
                <tr key={g.slug}>
                  <td className="p-2.5">
                    <Link className="inline-flex items-center gap-2 text-indigo-700 hover:underline" href={`/guides/${g.slug}`}>
                      <AppLogo src={g.logo} name={g.name} size="sm" />
                      {g.name}
                    </Link>
                  </td>
                  <td className="p-2.5 whitespace-nowrap text-xs">
                    <TrustBadge level={g.stats.trust.level} />
                    <span className="ml-1.5 text-stone-500">{g.origin === "curated" ? "curated" : "generated"}</span>
                  </td>
                  <td className="p-2.5 whitespace-nowrap">{g.verdict.label} · {g.verdict.calendar}</td>
                  <td className="p-2.5 whitespace-nowrap tabular-nums">{g.stats.agent} · {g.stats.you} · {g.stats.wait} <span className="text-stone-400">/ {g.stats.steps}</span></td>
                  <td className="p-2.5 whitespace-nowrap tabular-nums"><span className="text-emerald-700">{g.stats.tested}</span> / <span className="text-sky-700">{g.stats.sourced}</span> / <span className="text-stone-500">{g.stats.inferred}</span></td>
                  <td className="p-2.5 whitespace-nowrap tabular-nums">
                    {g.stats.checks ? <><span className="text-emerald-700">{g.stats.checks.pass}</span> / <span className="text-amber-700">{g.stats.checks.warn}</span> / <span className="text-rose-700">{g.stats.checks.fail}</span></> : <span className="text-stone-400">—</span>}
                  </td>
                  <td className="p-2.5 whitespace-nowrap tabular-nums">
                    {g.stats.verification ? <><span className="text-emerald-700">{g.stats.verification.confirmed}</span> / <span className="text-amber-700">{g.stats.verification.corrected}</span> / <span className="text-stone-500">{g.stats.verification.unverified}</span></> : <span className="text-stone-400">—</span>}
                  </td>
                  <td className="p-2.5 tabular-nums">{g.stats.uncertain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-stone-500">
          Status = the same rules for every guide ({byTrust.verified} verified · {byTrust.checked} checked · {byTrust.unchecked} unchecked). Checks = automated pass / warn / fail. Claims = confirmed / corrected / unverified by a second pass. Open = questions the guide leaves unverified.
        </p>
        <div className="space-y-2">
          <div className="text-sm font-medium">What the claim re-check found, guide by guide</div>
          <p className="text-xs text-stone-500">Every guide that has been through a second pass is listed, whether or not anything needed correcting. Corrections were applied to the guide in place.</p>
          {library.map((g) => {
            const r = rows.find((x) => x.slug === g.slug);
            const corrected = r?.findings.filter((f) => f.result === "corrected") ?? [];
            const tone = !r ? "border-stone-200 bg-stone-50" : corrected.length ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/40";
            return (
              <details key={g.slug} className={`rounded-lg border p-3 text-sm ${tone}`}>
                <summary className="cursor-pointer">
                  <span className="font-medium"><Link href={`/guides/${g.slug}`} className="hover:underline">{g.name}</Link></span>
                  {r ? (
                    <>
                      : <span className="text-emerald-700">{r.confirmed} confirmed</span>, <span className="text-amber-700">{r.corrected} corrected</span>, <span className="text-stone-600">{r.unverified} unverified</span>
                      <span className="ml-2 text-xs text-stone-500">{r.kind === "automated" ? "automated re-check" : "independent agent"}</span>
                    </>
                  ) : (
                    <span className="text-stone-500">: not re-checked yet · <Link href={`/generate?verify=${g.slug}`} className="text-indigo-700 underline">run it</Link></span>
                  )}
                </summary>
                {r && (
                  <ul className="mt-2 space-y-1.5">
                    {r.findings.map((f, i) => (
                      <li key={i} className="flex gap-2">
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase h-fit ${f.result === "confirmed" ? "bg-emerald-100 text-emerald-800" : f.result === "corrected" ? "bg-amber-100 text-amber-800" : "bg-stone-200 text-stone-700"}`}>{f.result}</span>
                        <span><span className="font-medium">{f.claim}</span><span className="block text-xs text-stone-700">{f.note}</span></span>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            );
          })}
        </div>
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-stone-500 mt-1">{sub}</div>}
    </div>
  );
}

function Bar({ parts, total }: { parts: { n: number; cls: string; label: string }[]; total: number }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-stone-100" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")}>
      {parts.map((p) => (
        <span key={p.label} className={p.cls} style={{ width: `${(p.n / total) * 100}%` }} />
      ))}
    </div>
  );
}
