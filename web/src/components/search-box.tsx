"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export function SearchBox({ library }: { library: { slug: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return library.filter((g) => g.name.toLowerCase().includes(s) || g.slug.includes(s)).slice(0, 5);
  }, [q, library]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = q.trim();
    if (!s) return;
    const exact = library.find((g) => g.name.toLowerCase() === s.toLowerCase() || g.slug === s.toLowerCase());
    router.push(exact ? `/guides/${exact.slug}` : `/generate?q=${encodeURIComponent(s)}`);
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
            <button key={m.slug} onClick={() => router.push(`/guides/${m.slug}`)} className="rounded-full bg-white border border-stone-200 px-3 py-1 hover:border-indigo-300">
              {m.name}
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
