import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { put, list } from "@vercel/blob";
import { curated } from "@/data/guides";
import type { StoredGuide } from "./schema";

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

export type GuideSummary = Pick<StoredGuide, "slug" | "name" | "category" | "summary" | "verdict"> & {
  origin: StoredGuide["meta"]["origin"];
  generated_at: string;
};

const summarize = (g: StoredGuide): GuideSummary => ({
  slug: g.slug,
  name: g.name,
  category: g.category,
  summary: g.summary,
  verdict: g.verdict,
  origin: g.meta.origin,
  generated_at: g.meta.generated_at,
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
