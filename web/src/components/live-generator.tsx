"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { AgentEvent } from "@/lib/agent";
import type { CheckResult, CheckGroup, CheckStatus, StoredGuide } from "@/lib/schema";
import { AppLogo } from "./app-logo";

export type AppHint = { name: string; logo: string | null; managed: boolean | null; inDirectory: boolean };
type Finding = NonNullable<StoredGuide["meta"]["verification"]>["findings"][number];
type LogItem = { t: number; kind: string; text: string; sub?: string };

const PHASES = ["research", "synthesis", "saving", "verify", "done"] as const;
type Phase = (typeof PHASES)[number];
const PHASE_LABEL: Record<Phase, string> = {
  research: "Investigate docs & probe endpoints",
  synthesis: "Write structured guide",
  saving: "Save shareable link",
  verify: "Verify: links, endpoints, claims",
  done: "Done",
};

const GROUPS: { id: CheckGroup; title: string; icon: string; blurb: string }[] = [
  { id: "links", title: "Sources", icon: "🔗", blurb: "Re-fetching every cited page" },
  { id: "endpoints", title: "Live endpoints", icon: "📡", blurb: "Probing authorize, token and discovery URLs" },
  { id: "consistency", title: "Consistency", icon: "🧩", blurb: "Verdict, stages, steps and citations agree" },
  { id: "catalog", title: "Composio catalog", icon: "🗂️", blurb: "Managed app and default scopes" },
  { id: "usability", title: "Usability", icon: "🧪", blurb: "Instructions and exports render" },
  { id: "claims", title: "Independent re-check", icon: "⚖️", blurb: "A second model checks the key claims against fresh sources" },
];

const STATUS: Record<CheckStatus, { icon: string; cls: string; ring: string }> = {
  pass: { icon: "✓", cls: "text-emerald-700 bg-emerald-100", ring: "ring-emerald-200" },
  warn: { icon: "!", cls: "text-amber-800 bg-amber-100", ring: "ring-amber-200" },
  fail: { icon: "✕", cls: "text-rose-700 bg-rose-100", ring: "ring-rose-200" },
  skip: { icon: "–", cls: "text-stone-500 bg-stone-100", ring: "ring-stone-200" },
};

export function LiveGenerator({ needsPasscode, app }: { needsPasscode: boolean; app: AppHint | null }) {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get("q") ?? "";
  const verifySlug = params.get("verify") ?? "";
  const force = params.get("force") === "1";
  const [passcode, setPasscode] = useState("");
  const [started, setStarted] = useState(!needsPasscode);
  const [phase, setPhase] = useState<Phase>(verifySlug ? "verify" : "research");
  const [log, setLog] = useState<LogItem[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ searches: 0, fetches: 0, probes: 0, chars: 0 });
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [claims, setClaims] = useState<Finding[]>([]);
  const [verified, setVerified] = useState<Extract<AgentEvent, { type: "verified" }> | null>(null);
  const [guideSlug, setGuideSlug] = useState<string | null>(verifySlug || null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const ran = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // After verification finishes, give the summary a moment on screen, then open the guide.
  useEffect(() => {
    if (phase !== "done" || !guideSlug || error) return;
    setCountdown(4);
    const id = setInterval(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    const go = setTimeout(() => router.push(`/guides/${guideSlug}`), 4000);
    return () => {
      clearInterval(id);
      clearTimeout(go);
    };
  }, [phase, guideSlug, error, router]);

  useEffect(() => {
    if (!started || (!q && !verifySlug) || ran.current) return;
    const ctrl = new AbortController();
    // Start on the next tick: React Strict Mode (dev only) mounts, unmounts and remounts the
    // component synchronously, and the cleanup below cancels the timer, so only the final
    // mount sends a request.
    const timer = setTimeout(() => {
      ran.current = true;
      startRef.current = Date.now();
      const add = (kind: string, text: string, sub?: string) =>
        setLog((l) => [...l, { t: Math.round((Date.now() - startRef.current) / 1000), kind, text, sub }]);

      (async () => {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            verifySlug
              ? { verify: verifySlug, passcode: passcode || sessionStorage.getItem("passcode") || undefined }
              : { query: q, force, passcode: passcode || sessionStorage.getItem("passcode") || undefined },
          ),
          signal: ctrl.signal,
        }).catch((e) => {
          if (!ctrl.signal.aborted) setError(String(e));
          return null;
        });
        if (!res || ctrl.signal.aborted) return;
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          setError(j.error ?? `Request failed (${res.status})`);
          if (res.status === 401) {
            ran.current = false;
            setStarted(false);
          }
          return;
        }
        if (passcode) sessionStorage.setItem("passcode", passcode);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (e) {
            if (!ctrl.signal.aborted) setError(String(e));
            break;
          }
          const { done, value } = chunk;
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const p of parts) {
            if (!p.startsWith("data: ")) continue;
            const e = JSON.parse(p.slice(6)) as AgentEvent;
            switch (e.type) {
              case "phase":
                setPhase(e.phase);
                add("phase", e.message);
                break;
              case "search":
                setStats((s) => ({ ...s, searches: s.searches + 1 }));
                add("search", e.query);
                break;
              case "search_results":
                break;
              case "fetch":
                setStats((s) => ({ ...s, fetches: s.fetches + 1 }));
                add("fetch", e.url);
                break;
              case "probe":
                setStats((s) => ({ ...s, probes: s.probes + 1 }));
                add("probe", e.url, e.error ? `error: ${e.error}` : `HTTP ${e.status}`);
                break;
              case "note":
                setNote((n) => (n + e.text).slice(-600));
                break;
              case "progress":
                setStats((s) => ({ ...s, chars: e.chars }));
                break;
              case "guide":
                setGuideSlug(e.slug);
                add("phase", "Guide saved. Verifying it before opening…");
                break;
              case "check":
                setChecks((c) => [...c, e.result]);
                break;
              case "claim":
                setClaims((c) => [...c, e.finding]);
                break;
              case "verified":
                setVerified(e);
                break;
              case "error":
                setError(e.message);
                break;
            }
          }
        }
      })();
    }, 0);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
      ran.current = false;
    };
  }, [started, q, verifySlug, force, passcode, router]);

  if (!q && !verifySlug) return <p>Nothing to investigate. Go back and enter an app.</p>;

  const title = app?.inDirectory || verifySlug ? (app?.name ?? q) : null;

  if (!started)
    return (
      <form
        className="max-w-md space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setStarted(true);
        }}
      >
        <div className="flex items-center gap-3">
          <AppLogo src={app?.logo} name={app?.name ?? q} size="lg" />
          <h1 className="text-xl font-semibold">{verifySlug ? "Re-check" : "Investigate"} {title ?? <>&ldquo;{q}&rdquo;</>}</h1>
        </div>
        <p className="text-sm text-stone-600">Live generation runs on a rate-limited model quota, so this demo needs a passcode (it&apos;s in the submission notes).</p>
        <input value={passcode} onChange={(e) => setPasscode(e.target.value)} type="password" placeholder="Passcode" className="w-full rounded-lg border border-stone-300 px-3 py-2" />
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <button className="rounded-lg bg-stone-900 px-4 py-2 text-white">Start</button>
      </form>
    );

  const phaseIdx = PHASES.indexOf(phase);
  const verifying = phase === "verify" || phase === "done";
  const tally = checks.reduce((a, c) => ({ ...a, [c.status]: a[c.status] + 1 }), { pass: 0, warn: 0, fail: 0, skip: 0 } as Record<CheckStatus, number>);
  const lastGroup = checks[checks.length - 1]?.group;
  const groupsToShow = GROUPS.filter((g) => g.id !== "claims" || claims.length || checks.some((c) => c.group === "claims") || !verifySlug);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wide text-indigo-600 font-medium">✦ {verifySlug ? "Automated re-check" : "Agent investigation"} · {elapsed}s</div>
        <div className="flex items-center gap-3 mt-1">
          <AppLogo src={app?.logo} name={app?.name ?? q} size="lg" />
          <div>
            <h1 className="text-2xl font-semibold">{verifySlug ? "Re-checking the guide for" : "Building a guide for"} {title ?? <>&ldquo;{q}&rdquo;</>}</h1>
            {app?.inDirectory && (
              <div className="text-xs text-stone-500">
                In Composio&apos;s OAuth catalog · {app.managed ? "Composio-managed OAuth app available" : "bring your own OAuth app"}
              </div>
            )}
          </div>
        </div>
        {!verifySlug && (
          <p className="text-sm text-stone-600 mt-2">
            The agent reads the provider&apos;s developer docs, probes its live OAuth endpoints and writes a guide where each claim is labeled tested,
            sourced or inferred. Then a verifier re-fetches every source, re-probes the endpoints and has a second model re-check the key claims.
          </p>
        )}
      </div>

      <ol className={`grid gap-2 ${verifySlug ? "sm:grid-cols-2" : "sm:grid-cols-5"}`}>
        {(verifySlug ? (["verify", "done"] as Phase[]) : PHASES).map((p) => {
          const i = PHASES.indexOf(p);
          const done = i < phaseIdx || phase === "done";
          const active = i === phaseIdx && phase !== "done";
          return (
            <li key={p} className={`relative overflow-hidden rounded-lg border px-3 py-2 text-sm ${done ? "border-emerald-200 bg-emerald-50 text-emerald-800" : active ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-stone-200 bg-white text-stone-400"}`}>
              {active && <span className="pointer-events-none absolute inset-0 shimmer" aria-hidden />}
              <span className="relative mr-1">{done ? "✓" : active ? "…" : "○"}</span>
              <span className="relative">{PHASE_LABEL[p]}</span>
            </li>
          );
        })}
      </ol>

      {!verifySlug && (
        <div className="flex flex-wrap gap-6 text-sm text-stone-600">
          <span><b className="text-stone-900">{stats.searches}</b> searches</span>
          <span><b className="text-stone-900">{stats.fetches}</b> pages read</span>
          <span><b className="text-stone-900">{stats.probes}</b> live probes</span>
          {stats.chars > 0 && <span><b className="text-stone-900">{(stats.chars / 1000).toFixed(1)}k</b> chars of guide written</span>}
          {checks.length > 0 && <span><b className="text-stone-900">{checks.length}</b> checks run</span>}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}{" "}
          <button className="underline ml-2" onClick={() => location.reload()}>Retry</button>
          {guideSlug && <Link href={`/guides/${guideSlug}`} className="underline ml-3">Open the guide anyway</Link>}
        </div>
      )}

      {note && phase === "research" && (
        <div className="rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-600 italic">
          <span className="not-italic text-xs font-medium text-stone-400 mr-2">AGENT NOTE</span>
          {note.slice(-300)}
        </div>
      )}

      {verifying && (
        <section className="space-y-4 rise">
          {/* Scoreboard */}
          <div className="relative overflow-hidden rounded-2xl border border-stone-200 bg-gradient-to-br from-white via-indigo-50/40 to-emerald-50/50 p-5">
            {phase === "verify" && <span className="pointer-events-none absolute inset-0 shimmer" aria-hidden />}
            <div className="relative flex flex-wrap items-center gap-6">
              <div>
                <div className="text-xs uppercase tracking-wide text-stone-500">{phase === "done" ? "Verification complete" : "Verifying"}</div>
                <div className="text-2xl font-semibold mt-0.5">
                  {checks.length} check{checks.length === 1 ? "" : "s"}{claims.length ? ` · ${claims.length} claim${claims.length === 1 ? "" : "s"} re-checked` : ""}
                </div>
              </div>
              <div className="flex gap-3 ml-auto">
                <Score n={tally.pass} label="pass" cls="text-emerald-700" />
                <Score n={tally.warn} label="warn" cls="text-amber-700" />
                <Score n={tally.fail} label="fail" cls="text-rose-700" />
                {tally.skip > 0 && <Score n={tally.skip} label="skipped" cls="text-stone-500" />}
              </div>
            </div>
            {verified && (
              <div className="relative mt-3 text-sm text-stone-700">
                {verified.applied > 0 ? `${verified.applied} correction${verified.applied === 1 ? "" : "s"} applied to the guide and logged.` : "No corrections were needed."}
                {guideSlug && phase === "done" && (
                  <span className="ml-2 text-stone-500">Opening the guide{countdown !== null && countdown > 0 ? ` in ${countdown}s` : ""}…</span>
                )}
              </div>
            )}
            {guideSlug && (
              <div className="relative mt-3">
                <Link href={`/guides/${guideSlug}`} className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
                  Open guide {phase !== "done" && <span className="text-stone-300 font-normal">(checks keep running)</span>} →
                </Link>
              </div>
            )}
          </div>

          {/* Check groups */}
          <div className="grid md:grid-cols-2 gap-3">
            {groupsToShow.map((grp) => {
              const rows = checks.filter((c) => c.group === grp.id);
              const active = phase === "verify" && (grp.id === lastGroup || (!rows.length && GROUPS.findIndex((x) => x.id === lastGroup) + 1 === GROUPS.findIndex((x) => x.id === grp.id)));
              const pending = !rows.length && !(grp.id === "claims" && claims.length);
              return (
                <div key={grp.id} className={`rounded-xl border bg-white p-4 transition ${active ? "border-indigo-300 shadow-[0_0_0_4px_rgba(99,102,241,0.08)]" : pending ? "border-stone-200 opacity-60" : "border-stone-200"}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg" aria-hidden>{grp.icon}</span>
                    <div className="min-w-0">
                      <div className="font-medium">{grp.title}</div>
                      <div className="text-xs text-stone-500">{grp.blurb}</div>
                    </div>
                    <div className="ml-auto flex items-center gap-1 text-xs">
                      {active && <span className="inline-flex gap-0.5 mr-1"><Dot d={0} /><Dot d={150} /><Dot d={300} /></span>}
                      {rows.length > 0 && <GroupTally rows={rows} />}
                      {pending && !active && <span className="text-stone-400">{phase === "done" ? "n/a" : "queued"}</span>}
                    </div>
                  </div>
                  {rows.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {rows.map((c) => (
                        <li key={c.id} className="flex gap-2 text-sm rise">
                          <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${STATUS[c.status].cls}`}>{STATUS[c.status].icon}</span>
                          <span className="min-w-0">
                            <span className="font-medium">{c.label}</span>
                            {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="ml-1 text-xs text-stone-400 hover:text-indigo-700 break-all">{c.url.replace(/^https?:\/\//, "").slice(0, 60)}</a>}
                            <span className="block text-stone-600 text-xs">{c.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {grp.id === "claims" && claims.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {claims.map((f, i) => (
                        <li key={i} className={`rounded-lg p-2.5 text-sm ring-1 rise ${f.result === "confirmed" ? "bg-emerald-50/60 ring-emerald-200" : f.result === "corrected" ? "bg-amber-50/70 ring-amber-200" : "bg-stone-50 ring-stone-200"}`}>
                          <div className="flex items-start gap-2">
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${f.result === "confirmed" ? "bg-emerald-100 text-emerald-800" : f.result === "corrected" ? "bg-amber-100 text-amber-800" : "bg-stone-200 text-stone-700"}`}>{f.result}</span>
                            <span className="font-medium">{f.claim}</span>
                          </div>
                          <div className="mt-1 text-xs text-stone-700">{f.note}</div>
                          {f.quote && <div className="mt-1 text-xs italic text-stone-500 border-l-2 border-stone-300 pl-2">&ldquo;{f.quote}&rdquo;</div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!verifySlug && (
        <ul className="rounded-xl border border-stone-200 bg-white divide-y divide-stone-100 font-mono text-xs">
          {log.map((l, i) => (
            <li key={i} className="flex gap-3 px-3 py-2">
              <span className="text-stone-400 w-10 shrink-0">{l.t}s</span>
              <span className={`w-14 shrink-0 font-semibold ${l.kind === "search" ? "text-sky-700" : l.kind === "fetch" ? "text-violet-700" : l.kind === "probe" ? "text-emerald-700" : "text-stone-500"}`}>
                {l.kind}
              </span>
              <span className="break-all text-stone-800">{l.text}</span>
              {l.sub && <span className="ml-auto shrink-0 text-stone-500">{l.sub}</span>}
            </li>
          ))}
          {log.length === 0 && !error && <li className="px-3 py-2 text-stone-400">Starting…</li>}
        </ul>
      )}
    </div>
  );
}

function Score({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <div className="text-center min-w-[3rem]">
      <div className={`text-2xl font-semibold tabular-nums ${cls}`}>{n}</div>
      <div className="text-[11px] uppercase tracking-wide text-stone-500">{label}</div>
    </div>
  );
}

function GroupTally({ rows }: { rows: CheckResult[] }) {
  const n = (s: CheckStatus) => rows.filter((r) => r.status === s).length;
  return (
    <span className="inline-flex gap-1">
      {n("pass") > 0 && <span className="rounded-full bg-emerald-100 px-1.5 text-emerald-800">{n("pass")} ✓</span>}
      {n("warn") > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-amber-800">{n("warn")} !</span>}
      {n("fail") > 0 && <span className="rounded-full bg-rose-100 px-1.5 text-rose-800">{n("fail")} ✕</span>}
    </span>
  );
}

function Dot({ d }: { d: number }) {
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: `${d}ms` }} />;
}
