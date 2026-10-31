import type { Guide } from "@/lib/schema";

type Evidence = "tested" | "sourced" | "inferred";
type Owner = "agent" | "you" | "wait";

const DIFF_STYLE: Record<number, string> = {
  1: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  2: "bg-lime-100 text-lime-800 ring-lime-200",
  3: "bg-amber-100 text-amber-800 ring-amber-200",
  4: "bg-orange-100 text-orange-800 ring-orange-200",
  5: "bg-rose-100 text-rose-800 ring-rose-200",
};

export function DifficultyPill({ verdict }: { verdict: Guide["verdict"] }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${DIFF_STYLE[verdict.difficulty] ?? DIFF_STYLE[3]}`}>
      <DifficultyDots n={verdict.difficulty} />
      {verdict.label}
    </span>
  );
}

export function DifficultyDots({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`difficulty ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= n ? "bg-current" : "bg-current opacity-20"}`} />
      ))}
    </span>
  );
}

const EVIDENCE: Record<Evidence, { label: string; cls: string; title: string }> = {
  tested: { label: "Tested", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", title: "Confirmed by a hands-on attempt or a live probe" },
  sourced: { label: "Sourced", cls: "bg-sky-50 text-sky-700 ring-sky-200", title: "Stated in a cited source (usually official docs)" },
  inferred: { label: "Inferred", cls: "bg-stone-100 text-stone-600 ring-stone-200", title: "Reasoned from indirect evidence; verify before relying on it" },
};

export function EvidenceBadge({ e }: { e: Evidence }) {
  const s = EVIDENCE[e] ?? EVIDENCE.inferred;
  return (
    <span title={s.title} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${s.cls}`}>
      {s.label}
    </span>
  );
}

const OWNER: Record<Owner, { label: string; cls: string; icon: string }> = {
  agent: { label: "Agent can do", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200", icon: "✦" },
  you: { label: "You do", cls: "bg-stone-900 text-white ring-stone-900", icon: "●" },
  wait: { label: "Wait", cls: "bg-amber-50 text-amber-800 ring-amber-200", icon: "◷" },
};

export function OwnerBadge({ o }: { o: Owner }) {
  const s = OWNER[o] ?? OWNER.you;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

export const APPROVAL_LABEL: Record<Guide["verdict"]["approval"], string> = {
  none: "No approval needed",
  "to-go-public": "Review to go public",
  always: "Review always required",
  "partner-contract": "Partner program / contract",
};
