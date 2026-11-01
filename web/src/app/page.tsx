import Link from "next/link";
import { listCurated, listGenerated } from "@/lib/store";
import { DIRECTORY, DIRECTORY_META, normKey } from "@/lib/directory";
import { DifficultyPill, TrustBadge, APPROVAL_LABEL } from "@/components/badges";
import { SearchBox, type SearchItem } from "@/components/search-box";
import { AppLogo } from "@/components/app-logo";
import { DirectoryBrowser, type DirectoryItem } from "@/components/directory-browser";

export const dynamic = "force-dynamic";

export default async function Home() {
  const curated = listCurated().sort((a, b) => a.verdict.difficulty - b.verdict.difficulty);
  const generated = (await listGenerated())
    .filter((g) => !curated.some((c) => c.slug === g.slug))
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at));
  const guides = [...curated, ...generated];

  // Map directory apps to existing guides by normalized slug or name ("google-calendar" ↔ "googlecalendar").
  const guideByKey = new Map<string, string>();
  for (const g of guides) {
    guideByKey.set(normKey(g.slug), g.slug);
    guideByKey.set(normKey(g.name), g.slug);
  }
  const directory: DirectoryItem[] = DIRECTORY.map((t) => ({
    slug: t.slug,
    name: t.name,
    logo: t.logo,
    category: t.category,
    managed: t.managed,
    guide: guideByKey.get(normKey(t.slug)) ?? guideByKey.get(normKey(t.name)) ?? null,
  }));
  const inDirectory = new Set(directory.filter((d) => d.guide).map((d) => d.guide!));
  const searchItems: SearchItem[] = [
    ...guides.map((g) => ({ slug: g.slug, name: g.name, logo: g.logo, guide: g.slug })),
    ...directory.filter((d) => !d.guide).map((d) => ({ slug: d.slug, name: d.name, logo: d.logo, guide: null })),
  ];
  const managedCount = directory.filter((d) => d.managed).length;

  return (
    <div className="space-y-12">
      <section className="space-y-5 pt-4">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight max-w-3xl">
          Will your users be able to connect <span className="text-indigo-600">this app</span> next week, or in two months?
        </h1>
        <p className="text-stone-600 max-w-2xl">
          Before you can launch an agent integration on your own OAuth app, the provider may need to review it. Look up a
          provider to see how hard setup is, how long approval takes, what can block you, and which steps an agent can handle.
          If the provider isn&apos;t listed, an agent will investigate it now.
        </p>
        <SearchBox library={searchItems} />
      </section>

      <section className="grid sm:grid-cols-3 gap-4 text-sm">
        <Concept title="Integration" body="Your product's connection to a provider. It is configured with an OAuth app's client ID and secret." />
        <Concept title="OAuth app" body="An app you register with the provider. Its name, logo and scopes appear on the consent screen, and the provider may review it before strangers can use it." />
        <Concept title="Connection" body="A single user authorizing your OAuth app. You get one token per user." />
      </section>
      <p className="text-sm text-stone-600 -mt-8 max-w-3xl">
        Managed OAuth apps (like Composio&apos;s) let you prototype today without registering anything. For production you
        usually want your own app: your brand on the consent screen, scopes you choose, your own rate limits, and an
        approval that belongs to you. The approval process is where the time goes.
      </p>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Guides</h2>
          <span className="text-xs text-stone-500">sorted easiest → hardest · {guides.length} guides</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {guides.map((g) => (
            <Link
              key={g.slug}
              href={`/guides/${g.slug}`}
              className="group rounded-xl border border-stone-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <AppLogo src={g.logo} name={g.name} />
                  <div className="min-w-0">
                    <div className="font-medium group-hover:text-indigo-700 truncate">{g.name}</div>
                    <div className="text-xs text-stone-500">{g.category}</div>
                  </div>
                </div>
                <DifficultyPill verdict={g.verdict} />
              </div>
              <p className="mt-2 text-sm text-stone-600 line-clamp-2">{g.summary}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                <span>⏱ {g.verdict.hands_on} hands-on</span>
                <span>📅 {g.verdict.calendar} to production</span>
                <span>{APPROVAL_LABEL[g.verdict.approval]}</span>
                <TrustBadge level={g.stats.trust.level} />
                {g.origin === "generated" && <span className="text-indigo-600">✦ agent-generated</span>}
                {!inDirectory.has(g.slug) && <span className="text-stone-400">not in Composio&apos;s catalog</span>}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">App directory</h2>
          <span className="text-xs text-stone-500">
            {directory.length} OAuth apps · {managedCount} with a Composio-managed OAuth app · from{" "}
            <a href={DIRECTORY_META.source} className="underline hover:text-stone-800" target="_blank" rel="noreferrer">
              Composio&apos;s managed OAuth catalog
            </a>{" "}
            ({DIRECTORY_META.fetched_at})
          </span>
        </div>
        <p className="text-sm text-stone-600 max-w-3xl">
          Every app that supports OAuth in the catalog. Apps with a guide open it; any other app starts a live agent
          investigation that writes its guide in about a minute.
        </p>
        <DirectoryBrowser items={directory} />
      </section>
    </div>
  );
}

function Concept({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="font-medium">{title}</div>
      <div className="text-stone-600 mt-1">{body}</div>
    </div>
  );
}
