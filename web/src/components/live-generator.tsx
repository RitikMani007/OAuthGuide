"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AgentEvent } from "@/lib/agent";

type LogItem = { t: number; kind: string; text: string; sub?: string };

const PHASES = ["research", "synthesis", "saving", "done"] as const;
const PHASE_LABEL: Record<(typeof PHASES)[number], string> = {
  research: "Investigate docs & probe endpoints",
  synthesis: "Write structured guide",
  saving: "Save shareable link",
  done: "Done",
};

export function LiveGenerator({ needsPasscode }: { needsPasscode: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get("q") ?? "";
  const force = params.get("force") === "1";
  const [passcode, setPasscode] = useState("");
  const [started, setStarted] = useState(!needsPasscode);
  const [phase, setPhase] = useState<(typeof PHASES)[number]>("research");
  const [log, setLog] = useState<LogItem[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ searches: 0, fetches: 0, probes: 0, chars: 0 });
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const ran = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!started || !q || ran.current) return;
    ran.current = true;
    startRef.current = Date.now();
    const ctrl = new AbortController();
    const add = (kind: string, text: string, sub?: string) =>
      setLog((l) => [...l, { t: Math.round((Date.now() - startRef.current) / 1000), kind, text, sub }]);

    (async () => {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, force, passcode: passcode || sessionStorage.getItem("passcode") || undefined }),
        signal: ctrl.signal,
      }).catch((e) => {
        setError(String(e));
        return null;
      });
      if (!res) return;
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
        const { done, value } = await reader.read();
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
              add("phase", "Guide ready, opening…");
              setTimeout(() => router.push(`/guides/${e.slug}`), 600);
              break;
            case "error":
              setError(e.message);
              break;
          }
        }
      }
    })();
    return () => ctrl.abort();
  }, [started, q, force, passcode, router]);

  if (!q) return <p>Nothing to investigate. Go back and enter an app.</p>;

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
        <h1 className="text-xl font-semibold">Investigate &ldquo;{q}&rdquo;</h1>
        <p className="text-sm text-stone-600">Live generation calls a paid model, so this demo needs a passcode (it&apos;s in the submission notes).</p>
        <input value={passcode} onChange={(e) => setPasscode(e.target.value)} type="password" placeholder="Passcode" className="w-full rounded-lg border border-stone-300 px-3 py-2" />
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <button className="rounded-lg bg-stone-900 px-4 py-2 text-white">Start investigation</button>
      </form>
    );

  const phaseIdx = PHASES.indexOf(phase);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wide text-indigo-600 font-medium">✦ Agent investigation · {elapsed}s</div>
        <h1 className="text-2xl font-semibold mt-1">Building a guide for &ldquo;{q}&rdquo;</h1>
        <p className="text-sm text-stone-600 mt-1">
          The agent searches developer docs, reads them, and probes the provider&apos;s live OAuth endpoints. Then it writes a
          guide where each claim is labeled tested, sourced or inferred. This usually takes 2–4 minutes.
        </p>
      </div>

      <ol className="grid sm:grid-cols-4 gap-2">
        {PHASES.map((p, i) => (
          <li key={p} className={`rounded-lg border px-3 py-2 text-sm ${i < phaseIdx || phase === "done" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : i === phaseIdx ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-stone-200 bg-white text-stone-400"}`}>
            <span className="mr-1">{i < phaseIdx || phase === "done" ? "✓" : i === phaseIdx ? "…" : "○"}</span>
            {PHASE_LABEL[p]}
          </li>
        ))}
      </ol>

      <div className="flex gap-6 text-sm text-stone-600">
        <span><b className="text-stone-900">{stats.searches}</b> searches</span>
        <span><b className="text-stone-900">{stats.fetches}</b> pages read</span>
        <span><b className="text-stone-900">{stats.probes}</b> live probes</span>
        {stats.chars > 0 && <span><b className="text-stone-900">{(stats.chars / 1000).toFixed(1)}k</b> chars of guide written</span>}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}{" "}
          <button className="underline ml-2" onClick={() => location.reload()}>Retry</button>
        </div>
      )}

      {note && phase === "research" && (
        <div className="rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-600 italic">
          <span className="not-italic text-xs font-medium text-stone-400 mr-2">AGENT NOTE</span>
          {note.slice(-300)}
        </div>
      )}

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
    </div>
  );
}
