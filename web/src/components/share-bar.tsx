"use client";

import { useState } from "react";
import type { StoredGuide } from "@/lib/schema";
import { guideToMarkdown } from "@/lib/export";

export function ShareBar({ guide }: { guide: StoredGuide }) {
  const [copied, setCopied] = useState<string | null>(null);
  const flash = (s: string) => {
    setCopied(s);
    setTimeout(() => setCopied(null), 1600);
  };
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(label);
    } catch {
      flash("Copy failed");
    }
  };

  const btn = "rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:border-stone-500";
  return (
    <div className="flex flex-wrap gap-2 no-print">
      <button className={btn} onClick={() => copy(location.href, "Link copied")}>🔗 Copy link</button>
      <button className={btn} onClick={() => copy(guideToMarkdown(guide, location.href), "Markdown copied")}>📋 Copy as Markdown</button>
      <button className={btn} onClick={() => copy(JSON.stringify(guide, null, 2), "JSON copied")}>{"{ }"} Copy JSON (for agents)</button>
      <button className={btn} onClick={() => window.print()}>🖨 Print / PDF</button>
      {copied && <span className="text-sm text-emerald-700 self-center">{copied}</span>}
    </div>
  );
}
