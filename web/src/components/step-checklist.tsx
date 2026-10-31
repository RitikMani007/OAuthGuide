"use client";

import { useEffect, useState } from "react";
import { EvidenceBadge, OwnerBadge } from "./badges";

type Step = {
  title: string;
  phase: string;
  owner: "agent" | "you" | "wait";
  time: string;
  detailHtml: string;
  agentHtml: string | null;
  gotchas: string[];
  evidence: "tested" | "sourced" | "inferred";
  sources: { id: string; title: string; url: string }[];
};

export function StepChecklist({ slug, steps }: { slug: string; steps: Step[] }) {
  const key = `steps:${slug}`;
  const [done, setDone] = useState<boolean[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    try {
      setDone(JSON.parse(localStorage.getItem(key) ?? "[]"));
    } catch {}
  }, [key]);

  const toggle = (i: number) => {
    const next = [...done];
    next[i] = !next[i];
    setDone(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };

  const nextIdx = steps.findIndex((_, i) => !done[i]);
  const completed = done.filter(Boolean).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-sm no-print">
        <div className="h-1.5 flex-1 rounded-full bg-stone-200 overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(completed / steps.length) * 100}%` }} />
        </div>
        <span className="text-stone-500 text-xs">{completed}/{steps.length} done</span>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const isNext = i === nextIdx;
          const expanded = open === i || (open === null && isNext);
          return (
            <li key={i} className={`rounded-xl border bg-white ${isNext ? "border-indigo-300 ring-2 ring-indigo-100" : "border-stone-200"} ${done[i] ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-3 p-3.5">
                <button
                  onClick={() => toggle(i)}
                  className={`mt-0.5 h-5 w-5 shrink-0 rounded border flex items-center justify-center text-xs ${done[i] ? "bg-emerald-500 border-emerald-500 text-white" : "border-stone-300 hover:border-stone-500"}`}
                  aria-label={done[i] ? "Mark not done" : "Mark done"}
                >
                  {done[i] ? "✓" : ""}
                </button>
                <button className="flex-1 text-left" onClick={() => setOpen(expanded ? -1 : i)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-stone-400 font-mono">{String(i + 1).padStart(2, "0")}</span>
                    <span className={`font-medium ${done[i] ? "line-through" : ""}`}>{s.title}</span>
                    {isNext && <span className="text-[10px] font-semibold uppercase text-indigo-600">Next</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    <OwnerBadge o={s.owner} />
                    <span>{s.time}</span>
                    <span className="text-stone-300">·</span>
                    <span>{s.phase}</span>
                    <EvidenceBadge e={s.evidence} />
                  </div>
                </button>
              </div>
              {expanded && (
                <div className="px-3.5 pb-4 pl-11 space-y-3 text-sm">
                  <div className="prose-guide text-stone-800" dangerouslySetInnerHTML={{ __html: s.detailHtml }} />
                  {s.agentHtml && (
                    <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3">
                      <div className="text-xs font-semibold text-indigo-700 mb-1">✦ An agent can help</div>
                      <div className="prose-guide text-indigo-950" dangerouslySetInnerHTML={{ __html: s.agentHtml }} />
                    </div>
                  )}
                  {s.gotchas.length > 0 && (
                    <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
                      <div className="text-xs font-semibold text-amber-800 mb-1">Gotchas</div>
                      <ul className="list-disc pl-5 space-y-1 text-amber-950">{s.gotchas.map((g, j) => <li key={j}>{g}</li>)}</ul>
                    </div>
                  )}
                  {s.sources.length > 0 && (
                    <div className="text-xs text-stone-500 flex flex-wrap gap-x-3 gap-y-1">
                      Sources:
                      {s.sources.map((src) => (
                        <a key={src.id} href={src.url} target="_blank" rel="noopener noreferrer" className="text-indigo-700 hover:underline">
                          [{src.id}] {src.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
