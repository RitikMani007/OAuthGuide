import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { put, list } from "@vercel/blob";
import { curated } from "@/data/guides";
import { resolveLogo } from "./directory";
import type { StoredGuide } from "./schema";
import { guideTrust, type Trust } from "./trust";

// Curated guides ship with the repo. Generated guides go to Vercel Blob in
// production (BLOB_READ_WRITE_TOKEN set) and to ./.data locally.
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL_DIR = path.join(process.cwd(), ".data", "guides");

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.(com|io|so|dev|app|co|ai|net|org)(\/.*)?$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function getCurated(slug: string): StoredGuide | null {
  return curated.find((g) => g.slug === slug) ?? null;
}

export async function getGenerated(slug: string): Promise<StoredGuide | null> {
  try {
    if (useBlob) {
      const { blobs } = await list({ prefix: `guides/${slug}.json`, limit: 1 });
      if (!blobs[0]) return null;
      const res = await fetch(blobs[0].url, { cache: "no-store" });
      return res.ok ? ((await res.json()) as StoredGuide) : null;
    }
    return JSON.parse(await fs.readFile(path.join(LOCAL_DIR, `${slug}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function getGuide(slug: string): Promise<StoredGuide | null> {
  return getCurated(slug) ?? (await getGenerated(slug));
}

export async function saveGenerated(guide: StoredGuide): Promise<void> {
  const body = JSON.stringify(guide, null, 2);
  if (useBlob) {
    await put(`guides/${guide.slug}.json`, body, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(path.join(LOCAL_DIR, `${guide.slug}.json`), body);
}

/** Persist a verified guide. Generated guides go back to their store; curated guides are
 *  written back to the repo JSON only in development (they ship with the build). */
export async function saveChecked(guide: StoredGuide): Promise<"generated" | "curated" | "skipped"> {
  if (guide.meta.origin === "generated") {
    await saveGenerated(guide);
    return "generated";
  }
  if (process.env.NODE_ENV === "production" || useBlob) return "skipped";
  const file = path.join(process.cwd(), "src/data/guides", `${guide.slug}.json`);
  await fs.writeFile(file, JSON.stringify(guide, null, 2) + "\n");
  return "curated";
}

export type GuideStats = {
  /** evidence labels across verdict, steps, blockers and review */
  tested: number;
  sourced: number;
  inferred: number;
  /** step ownership */
  agent: number;
  you: number;
  wait: number;
  steps: number;
  sources: number;
  probes: number;
  uncertain: number;
  verified: boolean;
  verification_kind: "independent" | "automated" | null;
  verification: { confirmed: number; corrected: number; unverified: number } | null;
  checks: { pass: number; warn: number; fail: number; skip: number; date: string } | null;
  /** the same trust rules for every guide */
  trust: Trust;
};

export type GuideSummary = Pick<StoredGuide, "slug" | "name" | "category" | "summary" | "verdict"> & {
  origin: StoredGuide["meta"]["origin"];
  generated_at: string;
  logo: string | null;
  stats: GuideStats;
  findings: { claim: string; result: "confirmed" | "corrected" | "unverified"; note: string }[];
};

export function guideStats(g: StoredGuide): GuideStats {
  const labels = [g.verdict.evidence, g.review.evidence, ...g.steps.map((s) => s.evidence), ...g.blockers.map((b) => b.evidence)];
  const count = <T extends string>(xs: T[], v: T) => xs.filter((x) => x === v).length;
  const owners = g.steps.map((s) => s.owner);
  return {
    tested: count(labels, "tested"),
    sourced: count(labels, "sourced"),
    inferred: count(labels, "inferred"),
    agent: count(owners, "agent"),
    you: count(owners, "you"),
    wait: count(owners, "wait"),
    steps: g.steps.length,
    sources: g.sources.length,
    probes: g.sources.filter((s) => s.kind === "tested").length,
    uncertain: g.uncertain.length,
    verified: !!g.meta.verification,
    verification_kind: g.meta.verification ? (g.meta.verification.kind ?? "independent") : null,
    verification: g.meta.verification
      ? {
          confirmed: g.meta.verification.findings.filter((f) => f.result === "confirmed").length,
          corrected: g.meta.verification.findings.filter((f) => f.result === "corrected").length,
          unverified: g.meta.verification.findings.filter((f) => f.result === "unverified").length,
        }
      : null,
    checks: g.meta.checks ? { ...g.meta.checks.summary, date: g.meta.checks.date } : null,
    trust: guideTrust(g),
  };
}

const summarize = (g: StoredGuide): GuideSummary => ({
  slug: g.slug,
  name: g.name,
  category: g.category,
  summary: g.summary,
  verdict: g.verdict,
  origin: g.meta.origin,
  generated_at: g.meta.generated_at,
  logo: g.meta.logo ?? resolveLogo({ name: g.name, website: g.website }),
  stats: guideStats(g),
  findings: (g.meta.verification?.findings ?? []).map(({ claim, result, note }) => ({ claim, result, note })),
});

export async function listGenerated(): Promise<GuideSummary[]> {
  try {
    if (useBlob) {
      const { blobs } = await list({ prefix: "guides/", limit: 100 });
      const guides = await Promise.all(
        blobs.map((b) =>
          fetch(b.url, { cache: "no-store" })
            .then((r) => (r.ok ? (r.json() as Promise<StoredGuide>) : null))
            .catch(() => null),
        ),
      );
      return guides.filter((g): g is StoredGuide => !!g).map(summarize);
    }
    const files = await fs.readdir(LOCAL_DIR).catch(() => []);
    const guides = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => JSON.parse(await fs.readFile(path.join(LOCAL_DIR, f), "utf8")) as StoredGuide),
    );
    return guides.map(summarize);
  } catch {
    return [];
  }
}

export function listCurated(): GuideSummary[] {
  return curated.map(summarize);
}
