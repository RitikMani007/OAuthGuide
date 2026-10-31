import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OAuth Runway: how long until your OAuth app is ready?",
  description:
    "Setup and approval guides for provider OAuth apps, for developers building AI agents. Look up an app or have an agent investigate a new one.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}>
        <header className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
            <Link href="/" className="font-semibold tracking-tight flex items-center gap-2">
              <span className="inline-block h-5 w-5 rounded bg-gradient-to-br from-indigo-500 to-emerald-500" aria-hidden />
              OAuth Runway
            </Link>
            <nav className="flex gap-5 text-sm text-stone-600">
              <Link href="/" className="hover:text-stone-900">Library</Link>
              <Link href="/method" className="hover:text-stone-900">Method &amp; evidence</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-10 text-xs text-stone-500 no-print">
          Guides are research aids, not legal advice. Provider policies change; check the linked sources before you rely on them.
        </footer>
      </body>
    </html>
  );
}
