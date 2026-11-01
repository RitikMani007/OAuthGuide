import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getGuide } from "@/lib/store";
import { md } from "@/lib/md";
import { DifficultyDots, EvidenceBadge, OwnerBadge, APPROVAL_LABEL } from "@/components/badges";
import { StepChecklist } from "@/components/step-checklist";
import { ShareBar } from "@/components/share-bar";
import { AppLogo } from "@/components/app-logo";
import { resolveLogo } from "@/lib/directory";
import type { StoredGuide } from "@/lib/schema";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const g = await getGuide((await params).slug);
  if (!g) return { title: "Guide not found" };
  return {
    title: `${g.name} OAuth app setup: ${g.verdict.label}, ${g.verdict.calendar} · OAuth Runway`,
    description: g.summary,
  };
}

const DIFF_BG: Record<number, string> = {
  1: "from-emerald-500 to-emerald-600",
  2: "from-lime-500 to-lime-600",
  3: "from-amber-500 to-amber-600",
  4: "from-orange-500 to-orange-600",
  5: "from-rose-500 to-rose-600",
};

export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const g = await getGuide(slug);
  if (!g) notFound();

  const srcById = new Map(g.sources.map((s) => [s.id, s]));
  const counts = countEvidence(g);
  const agentSteps = g.steps.filter((s) => s.owner === "agent").length;

  return (
    <article className="space-y-10 prose-guide-root">
      {/* Header */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <Link href="/" className="hover:text-stone-800">Library</Link>
          <span>/</span>
          <span>{g.category}</span>
          <span className="ml-auto">
            {g.meta.origin === "generated" ? (
              <span className="text-indigo-700">
                ✦ Agent-generated {fmtDate(g.meta.generated_at)} ·{" "}
                {g.meta.checks ? (
                  <>auto-checked: {g.meta.checks.summary.pass} pass, {g.meta.checks.summary.warn} warn, {g.meta.checks.summary.fail} fail{g.meta.verification?.kind === "automated" ? `, ${g.meta.verification.findings.length} claims re-checked` : ""} · not hand-reviewed</>
                ) : (
                  <>not yet checked</>
                )}
              </span>
            ) : (
              <span className="text-emerald-700">Curated · researched by agents, spot-checked {g.meta.verification ? fmtDate(g.meta.verification.date) : fmtDate(g.meta.generated_at)}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <AppLogo src={g.meta.logo ?? resolveLogo({ name: g.name, website: g.website })} name={g.name} size="lg" />
          <h1 className="text-3xl font-semibold tracking-tight">{g.name}: OAuth app setup &amp; approval</h1>
        </div>
        <p className="text-stone-700 max-w-3xl text-[15px] leading-relaxed">{g.summary}</p>
        <ShareBar guide={g} />
      </header>

      {/* Verdict */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={`rounded-xl bg-gradient-to-br ${DIFF_BG[g.verdict.difficulty] ?? DIFF_BG[3]} p-4 text-white`}>
          <div className="text-xs uppercase tracking-wide opacity-80">Difficulty</div>
          <div className="text-2xl font-semibold mt-1">{g.verdict.label}</div>
          <div className="mt-2"><DifficultyDots n={g.verdict.difficulty} /></div>
        </div>
        <Stat label="Your hands-on time" value={g.verdict.hands_on} />
        <Stat label="Calendar time to production" value={g.verdict.calendar} />
        <Stat label="Approval" value={APPROVAL_LABEL[g.verdict.approval]} />
      </section>
      <p className="-mt-7 text-sm text-stone-600">{g.verdict.time_note}</p>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 -mt-6 text-sm flex gap-3 items-start">
        <span className="text-amber-700 font-semibold shrink-0">Most likely to slow you down</span>
        <span className="text-amber-900">{g.verdict.headline_blocker}</span>
        <span className="ml-auto shrink-0"><EvidenceBadge e={g.verdict.evidence} /></span>
      </div>

      {/* Stage ladder */}
      <Section title="From test app to production" kicker="Where you can be today, and what each step up unlocks">
        <ol className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
          {g.stages.map((s, i) => (
            <li key={i} className="rounded-xl border border-stone-200 bg-white p-4 relative">
              <div className="text-xs font-medium text-stone-400">Stage {i + 1}</div>
              <div className="font-medium mt-0.5">{s.name}</div>
              <div className="text-sm text-stone-700 mt-2">{s.what_you_get}</div>
              <div className="text-xs text-stone-500 mt-2 border-t border-stone-100 pt-2"><b>How to get here:</b> {s.how_to_reach}</div>
            </li>
          ))}
        </ol>
        <div className="mt-3 rounded-lg bg-indigo-50 border border-indigo-100 p-3 text-sm text-indigo-900">
          <b>
            {g.managed_alternative.composio_managed === true
              ? "Managed OAuth app available: "
              : g.managed_alternative.composio_managed === false
                ? "No managed OAuth app: "
                : "Managed OAuth app: "}
          </b>
          {g.managed_alternative.note}
        </div>
      </Section>

      {/* Steps */}
      <Section
        title="Step-by-step"
        kicker={`${g.steps.length} steps · ${agentSteps} an agent can do for you · progress is saved in this browser`}
      >
        <StepChecklist
          slug={g.slug}
          steps={g.steps.map((s) => ({
            ...s,
            detailHtml: md(s.detail),
            agentHtml: s.agent_help ? md(s.agent_help) : null,
            sources: s.source_ids.map((id) => srcById.get(id)).filter((x): x is NonNullable<typeof x> => !!x),
          }))}
        />
      </Section>

      {/* Agent vs you */}
      <Section title="What an agent can do, and what you have to do" kicker="Split the work before you start">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
            <div className="mb-2"><OwnerBadge o="agent" /></div>
            <ul className="text-sm space-y-1.5 list-disc pl-5 text-stone-800">{g.agent_vs_you.agent_can.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
          <div className="rounded-xl border border-stone-300 bg-white p-4">
            <div className="mb-2"><OwnerBadge o="you" /></div>
            <ul className="text-sm space-y-1.5 list-disc pl-5 text-stone-800">{g.agent_vs_you.you_must.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        </div>
      </Section>

      {/* Review */}
      <Section title="Review & approval" kicker={<>Typical duration: <b>{g.review.typical_duration}</b> <EvidenceBadge e={g.review.evidence} /></>}>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-3">
            <Field label="Required when">{g.review.required_when}</Field>
            <Field label="Process"><div className="prose-guide" dangerouslySetInnerHTML={{ __html: md(g.review.process) }} /></Field>
          </div>
          <div className="space-y-3">
            <Field label="Have these ready">
              <ul className="space-y-1">{g.review.prepare.map((x, i) => <li key={i} className="flex gap-2"><span className="text-stone-400">☐</span>{x}</li>)}</ul>
            </Field>
            {g.review.common_rejections.length > 0 && (
              <Field label="Common rejection reasons">
                <ul className="list-disc pl-5 space-y-1">{g.review.common_rejections.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </Field>
            )}
          </div>
        </div>
      </Section>

      {/* Scopes */}
      {g.scopes.length > 0 && (
        <Section title="Scopes & what they trigger" kicker="Request the narrowest scopes your agent needs. Each tier up adds review work">
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs text-stone-500">
                <tr><th className="p-2.5">Scope</th><th className="p-2.5">Purpose</th><th className="p-2.5">Tier</th><th className="p-2.5">Triggers</th></tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {g.scopes.map((s, i) => (
                  <tr key={i}>
                    <td className="p-2.5 font-mono text-xs break-all">{s.scope}</td>
                    <td className="p-2.5 text-stone-700">{s.purpose}</td>
                    <td className="p-2.5"><TierPill tier={s.tier} /></td>
                    <td className="p-2.5 text-stone-700">{s.review_impact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Blockers */}
      <Section title="When you hit a blocker" kicker="Symptoms you might see and how to get past them">
        <div className="space-y-2">
          {g.blockers.map((b, i) => (
            <details key={i} className="rounded-xl border border-stone-200 bg-white p-4 group">
              <summary className="cursor-pointer font-medium flex items-center gap-2">
                <span className="text-rose-500">⚠</span>{b.title}
                <span className="ml-auto"><EvidenceBadge e={b.evidence} /></span>
              </summary>
              <div className="mt-3 text-sm space-y-2">
                <div><span className="text-stone-500">You see: </span><span className="font-mono text-xs bg-stone-50 px-1.5 py-0.5 rounded">{b.symptom}</span></div>
                <div className="prose-guide" dangerouslySetInnerHTML={{ __html: md(b.fix) }} />
              </div>
            </details>
          ))}
        </div>
      </Section>

      {/* OAuth config */}
      <Section title="OAuth configuration facts" kicker="For your integration config">
        <div className="rounded-xl border border-stone-200 bg-white divide-y divide-stone-100 text-sm">
          <Row k="Developer console" v={g.oauth.console_url} link />
          <Row k="OAuth docs" v={g.oauth.docs_url} link />
          <Row k="Authorize URL" v={g.oauth.authorize_url} mono />
          <Row k="Token URL" v={g.oauth.token_url} mono />
          <Row k="Redirect URIs" v={g.oauth.redirect_uri_rules} />
          <Row k="PKCE" v={g.oauth.pkce} />
          <Row k="Tokens & refresh" v={g.oauth.refresh_tokens} />
        </div>
        {g.oauth.notes.length > 0 && <ul className="mt-3 text-sm list-disc pl-5 space-y-1 text-stone-700">{g.oauth.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </Section>

      {/* Evidence */}
      <Section title="How much to trust this guide" kicker={`${counts.tested} tested · ${counts.sourced} sourced · ${counts.inferred} inferred claims`}>
        <EvidenceBar counts={counts} />
        {g.meta.checks && <ChecksPanel checks={g.meta.checks} slug={g.slug} />}
        {!g.meta.checks && (
          <div className="mt-4 no-print text-sm text-stone-600">
            This guide has not been through the automated checks yet.{" "}
            <Link href={`/generate?verify=${g.slug}`} className="text-indigo-700 underline">Run them now</Link>
          </div>
        )}
        {g.meta.verification && (
          <div className={`mt-4 rounded-xl border p-4 ${(g.meta.verification.kind ?? "independent") === "independent" ? "border-emerald-200 bg-emerald-50/50" : "border-indigo-200 bg-indigo-50/40"}`}>
            <div className="font-medium text-sm">
              {(g.meta.verification.kind ?? "independent") === "independent" ? "Independent verification log" : "Automated claim re-check"} · {fmtDate(g.meta.verification.date)}
            </div>
            <div className="text-xs text-stone-600 mt-0.5">{g.meta.verification.method}</div>
            <ul className="mt-3 space-y-2 text-sm">
              {g.meta.verification.findings.map((f, i) => (
                <li key={i} className="flex gap-2">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase h-fit ${f.result === "confirmed" ? "bg-emerald-100 text-emerald-800" : f.result === "corrected" ? "bg-amber-100 text-amber-800" : "bg-stone-200 text-stone-700"}`}>{f.result}</span>
                  <span>
                    <b>{f.claim}</b>: {f.note}
                    {f.quote && <span className="block text-xs italic text-stone-500 mt-0.5">&ldquo;{f.quote}&rdquo;</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {g.uncertain.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-medium">Not verified / may vary</div>
            <ul className="mt-1 text-sm list-disc pl-5 space-y-1 text-stone-700">{g.uncertain.map((u, i) => <li key={i}>{u}</li>)}</ul>
          </div>
        )}
        <div className="mt-4">
          <div className="text-sm font-medium">Sources</div>
          <ol className="mt-1 text-sm space-y-1">
            {g.sources.map((s) => (
              <li key={s.id} id={`src-${s.id}`} className="flex gap-2">
                <span className="text-stone-400 font-mono text-xs w-6 shrink-0 pt-0.5">{s.id}</span>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-indigo-700 hover:underline break-all">{s.title}</a>
                <span className="text-xs text-stone-400 shrink-0 pt-0.5">{s.kind}</span>
              </li>
            ))}
          </ol>
        </div>
        {g.meta.origin === "generated" && (
          <div className="mt-4 no-print text-sm">
            <Link href={`/generate?q=${encodeURIComponent(g.name)}&force=1`} className="text-indigo-700 underline">Re-run the agent for this app</Link>
            {g.meta.dossier && (
              <details className="mt-2">
                <summary className="cursor-pointer text-stone-600">Show the agent&apos;s raw research notes</summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs bg-white border border-stone-200 rounded-lg p-3 max-h-96 overflow-auto">{g.meta.dossier}</pre>
              </details>
            )}
          </div>
        )}
      </Section>
    </article>
  );
}

function countEvidence(g: StoredGuide) {
  const all = [g.verdict.evidence, g.review.evidence, ...g.steps.map((s) => s.evidence), ...g.blockers.map((b) => b.evidence)];
  return {
    tested: all.filter((e) => e === "tested").length,
    sourced: all.filter((e) => e === "sourced").length,
    inferred: all.filter((e) => e === "inferred").length,
  };
}

function EvidenceBar({ counts }: { counts: { tested: number; sourced: number; inferred: number } }) {
  const total = counts.tested + counts.sourced + counts.inferred || 1;
  return (
    <div className="flex h-2.5 rounded-full overflow-hidden bg-stone-100" title="Share of claims by evidence level">
      <div className="bg-emerald-500" style={{ width: `${(counts.tested / total) * 100}%` }} />
      <div className="bg-sky-500" style={{ width: `${(counts.sourced / total) * 100}%` }} />
      <div className="bg-stone-300" style={{ width: `${(counts.inferred / total) * 100}%` }} />
    </div>
  );
}

function Section({ title, kicker, children }: { title: string; kicker?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      {kicker && <div className="text-sm text-stone-500 mb-3 mt-0.5 flex items-center gap-2 flex-wrap">{kicker}</div>}
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="text-lg font-semibold mt-1 leading-snug">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-stone-500 mb-1">{label}</div>
      <div className="text-stone-800">{children}</div>
    </div>
  );
}

function Row({ k, v, link, mono }: { k: string; v: string | null; link?: boolean; mono?: boolean }) {
  if (!v) return null;
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 p-2.5">
      <div className="text-stone-500">{k}</div>
      <div className={`${mono ? "font-mono text-xs" : ""} break-all`}>
        {link && v.startsWith("http") ? <a className="text-indigo-700 hover:underline" href={v} target="_blank" rel="noopener noreferrer">{v}</a> : v}
      </div>
    </div>
  );
}

const TIER: Record<string, string> = {
  basic: "bg-emerald-50 text-emerald-700",
  sensitive: "bg-amber-50 text-amber-800",
  restricted: "bg-rose-50 text-rose-700",
  "partner-only": "bg-purple-50 text-purple-700",
  unknown: "bg-stone-100 text-stone-600",
};
function TierPill({ tier }: { tier: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TIER[tier] ?? TIER.unknown}`}>{tier}</span>;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const GROUP_TITLE: Record<string, string> = {
  links: "Sources re-fetched",
  endpoints: "Live endpoints",
  consistency: "Consistency rules",
  catalog: "Composio catalog",
  usability: "Usability & exports",
  claims: "Independent claim re-check",
};
const STATUS_CLS: Record<string, string> = {
  pass: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  fail: "bg-rose-100 text-rose-800",
  skip: "bg-stone-100 text-stone-600",
};
const STATUS_ICON: Record<string, string> = { pass: "✓", warn: "!", fail: "✕", skip: "–" };

function ChecksPanel({ checks, slug }: { checks: NonNullable<StoredGuide["meta"]["checks"]>; slug: string }) {
  const groups = [...new Set(checks.results.map((r) => r.group))];
  const s = checks.summary;
  return (
    <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <div className="font-medium text-sm">Automated checks · {fmtDate(checks.date)}</div>
          <div className="text-xs text-stone-600">
            {checks.results.length} checks in {(checks.duration_ms / 1000).toFixed(0)}s: sources re-fetched, endpoints probed, consistency and catalog rules, export smoke test.
          </div>
        </div>
        <div className="ml-auto flex gap-1.5 text-xs">
          <span className={`rounded-full px-2 py-0.5 ${STATUS_CLS.pass}`}>{s.pass} pass</span>
          <span className={`rounded-full px-2 py-0.5 ${STATUS_CLS.warn}`}>{s.warn} warn</span>
          <span className={`rounded-full px-2 py-0.5 ${STATUS_CLS.fail}`}>{s.fail} fail</span>
          {s.skip > 0 && <span className={`rounded-full px-2 py-0.5 ${STATUS_CLS.skip}`}>{s.skip} skipped</span>}
        </div>
      </div>
      {checks.applied.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm">
          <div className="font-medium text-amber-900 text-xs uppercase tracking-wide">Edits the verifier applied</div>
          <ul className="mt-1 list-disc pl-5 space-y-0.5 text-amber-950">{checks.applied.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}
      <div className="mt-3 grid sm:grid-cols-2 gap-2">
        {groups.map((grp) => {
          const rows = checks.results.filter((r) => r.group === grp);
          const worst = rows.some((r) => r.status === "fail") ? "fail" : rows.some((r) => r.status === "warn") ? "warn" : rows.every((r) => r.status === "skip") ? "skip" : "pass";
          return (
            <details key={grp} className="rounded-lg border border-stone-200 p-3 text-sm group">
              <summary className="cursor-pointer flex items-center gap-2">
                <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${STATUS_CLS[worst]}`}>{STATUS_ICON[worst]}</span>
                <span className="font-medium">{GROUP_TITLE[grp] ?? grp}</span>
                <span className="ml-auto text-xs text-stone-500">{rows.length}</span>
              </summary>
              <ul className="mt-2 space-y-1.5">
                {rows.map((r) => (
                  <li key={r.id} className="flex gap-2">
                    <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${STATUS_CLS[r.status]}`}>{STATUS_ICON[r.status]}</span>
                    <span className="min-w-0">
                      <span className="font-medium">{r.label}</span>
                      {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-xs text-stone-400 hover:text-indigo-700 break-all">{r.url.replace(/^https?:\/\//, "").slice(0, 70)}</a>}
                      <span className="block text-xs text-stone-600">{r.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
      <div className="mt-3 no-print text-xs">
        <Link href={`/generate?verify=${slug}`} className="text-indigo-700 underline">Re-run the checks</Link>
      </div>
    </div>
  );
}

