"use client";

import { useState } from "react";

const SIZES = { sm: "h-6 w-6 text-[10px]", md: "h-9 w-9 text-sm", lg: "h-14 w-14 text-xl" } as const;

/** Provider logo with a letter fallback when the image is missing or blocked. */
export function AppLogo({ src, name, size = "md", className = "" }: { src?: string | null; name: string; size?: keyof typeof SIZES; className?: string }) {
  const [failed, setFailed] = useState(false);
  const letter = name.trim().charAt(0).toUpperCase();
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white font-medium text-stone-500 overflow-hidden ${SIZES[size]} ${className}`}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" className="h-[68%] w-[68%] object-contain" onError={() => setFailed(true)} />
      ) : (
        letter
      )}
    </span>
  );
}
