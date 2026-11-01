"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppLogo } from "./app-logo";

export type SearchItem = { slug: string; name: string; logo: string | null; guide: string | null };

export function SearchBox({ library }: { library: SearchItem[] }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const k = norm(s);
    return library
      .filter((g) => g.name.toLowerCase().includes(s) || g.slug.includes(k))
      .sort((a, b) => Number(!!b.guide) - Number(!!a.guide) || Number(norm(b.name).startsWith(k)) - Number(norm(a.name).startsWith(k)))
      .slice(0, 6);
  }, [q, library]);

  const go = (m: SearchItem) => router.push(m.guide ? `/guides/${m.guide}` : `/generate?q=${encodeURIComponent(m.name)}`);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = q.trim();
    if (!s) return;
    const exact = library.find((g) => g.name.toLowerCase() === s.toLowerCase() || g.slug === norm(s));
    if (exact) go(exact);
    else router.push(`/generate?q=${encodeURIComponent(s)}`);
  }

  return (
    <div className="max-w-2xl">
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="App name or website, e.g. Zoom, airtable.com, Pipedrive"
          className="flex-1 rounded-lg border border-stone-300 bg-white px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          aria-label="App name or website"
        />
        <button className="rounded-lg bg-stone-900 px-5 py-3 text-white font-medium hover:bg-stone-700">Get guide</button>
      </form>
      {q.trim() && (
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {matches.map((m) => (
            <button key={m.slug} onClick={() => go(m)} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-stone-200 pl-1 pr-3 py-0.5 hover:border-indigo-300">
              <AppLogo src={m.logo} name={m.name} size="sm" />
              {m.name}
              <span className={`text-[10px] ${m.guide ? "text-emerald-700" : "text-stone-400"}`}>{m.guide ? "guide" : "generate"}</span>
            </button>
          ))}
          <button onClick={() => router.push(`/generate?q=${encodeURIComponent(q.trim())}`)} className="rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1 hover:bg-indigo-100">
            ✦ Investigate &ldquo;{q.trim()}&rdquo; with an agent
          </button>
        </div>
      )}
    </div>
  );
}
