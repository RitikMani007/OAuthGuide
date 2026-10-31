import Link from "next/link";
import { listCurated, listGenerated } from "@/lib/store";
import { DifficultyPill, APPROVAL_LABEL } from "@/components/badges";
import { SearchBox } from "@/components/search-box";

export const dynamic = "force-dynamic";

export default async function Home() {
  const curated = listCurated().sort((a, b) => a.verdict.difficulty - b.verdict.difficulty);
  const generated = (await listGenerated())
    .filter((g) => !curated.some((c) => c.slug === g.slug))
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at));
  const all = [...curated, ...generated];

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
        <SearchBox library={all.map((g) => ({ slug: g.slug, name: g.name }))} />
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
          <h2 className="text-lg font-semibold">Guide library</h2>
          <span className="text-xs text-stone-500">sorted easiest → hardest · {all.length} guides</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {all.map((g) => (
            <Link
              key={g.slug}
              href={`/guides/${g.slug}`}
              className="group rounded-xl border border-stone-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium group-hover:text-indigo-700">{g.name}</div>
                  <div className="text-xs text-stone-500">{g.category}</div>
                </div>
                <DifficultyPill verdict={g.verdict} />
              </div>
              <p className="mt-2 text-sm text-stone-600 line-clamp-2">{g.summary}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                <span>⏱ {g.verdict.hands_on} hands-on</span>
                <span>📅 {g.verdict.calendar} to production</span>
                <span>{APPROVAL_LABEL[g.verdict.approval]}</span>
                {g.origin === "generated" && <span className="text-indigo-600">✦ agent-generated</span>}
              </div>
            </Link>
          ))}
        </div>
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
