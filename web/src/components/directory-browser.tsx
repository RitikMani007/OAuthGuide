"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AppLogo } from "./app-logo";

export type DirectoryItem = {
  slug: string;
  name: string;
  logo: string | null;
  category: string;
  managed: boolean;
  /** slug of an existing guide for this app, if any */
  guide: string | null;
};

type Tab = "all" | "ready" | "managed" | "byo";

export function DirectoryBrowser({ items }: { items: DirectoryItem[] }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [cat, setCat] = useState("all");

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);
  const counts = useMemo(
    () => ({ all: items.length, ready: items.filter((i) => i.guide).length, managed: items.filter((i) => i.managed).length, byo: items.filter((i) => !i.managed).length }),
    [items],
  );

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        (tab === "all" || (tab === "ready" && i.guide) || (tab === "managed" && i.managed) || (tab === "byo" && !i.managed)) &&
        (cat === "all" || i.category === cat) &&
        (!s || i.name.toLowerCase().includes(s) || i.slug.includes(s.replace(/[^a-z0-9]/g, ""))),
    );
  }, [items, q, tab, cat]);

  const TABS: { id: Tab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "ready", label: "Guide ready" },
    { id: "managed", label: "Composio-managed OAuth" },
    { id: "byo", label: "Bring your own OAuth app" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter apps…"
          aria-label="Filter apps"
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 sm:w-64"
        />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category" className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm">
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs ${tab === t.id ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-600 hover:border-stone-400"}`}
            >
              {t.label} <span className="opacity-60">{counts[t.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {shown.map((i) => {
          const href = i.guide ? `/guides/${i.guide}` : `/generate?q=${encodeURIComponent(i.name)}`;
          return (
            <li key={i.slug}>
              <Link
                href={href}
                title={i.guide ? `Open the ${i.name} guide` : `Have an agent build a guide for ${i.name}`}
                className={`flex items-center gap-2.5 rounded-lg border bg-white p-2.5 transition hover:shadow-sm ${i.guide ? "border-emerald-200 hover:border-emerald-400" : "border-stone-200 hover:border-indigo-300"}`}
              >
                <AppLogo src={i.logo} name={i.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{i.name}</span>
                  <span className="block truncate text-[11px] text-stone-500">
                    {i.guide ? <span className="text-emerald-700">● Guide ready</span> : <span className="text-indigo-600">✦ Generate guide</span>}
                    {" · "}
                    {i.managed ? "managed app" : "bring your own"}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && (
        <p className="text-sm text-stone-500">
          No app matches. <Link href={`/generate?q=${encodeURIComponent(q.trim())}`} className="text-indigo-700 underline">Investigate &ldquo;{q.trim()}&rdquo; with an agent</Link>.
        </p>
      )}
    </div>
  );
}
