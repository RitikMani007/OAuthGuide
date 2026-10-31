import type { StoredGuide } from "./schema";

const OWNER = { agent: "🤖 Agent", you: "👤 You", wait: "⏳ Wait" } as const;

/** Plain markdown export so a guide can be pasted into a ticket, doc or chat. */
export function guideToMarkdown(g: StoredGuide, url?: string): string {
  const L: string[] = [];
  L.push(`# ${g.name}: OAuth app setup & approval`, "");
  L.push(g.summary, "");
  L.push(
    `**Difficulty:** ${g.verdict.label} (${g.verdict.difficulty}/5) · **Hands-on:** ${g.verdict.hands_on} · **Calendar:** ${g.verdict.calendar} · **Approval:** ${g.verdict.approval}`,
    "",
    `**Most likely blocker:** ${g.verdict.headline_blocker}`,
    "",
  );
  L.push("## Stages");
  g.stages.forEach((s, i) => L.push(`${i + 1}. **${s.name}**: ${s.what_you_get} _(How to get here: ${s.how_to_reach})_`));
  L.push("", "## Steps");
  g.steps.forEach((s, i) => {
    L.push(`- [ ] **${i + 1}. ${s.title}** · ${OWNER[s.owner]} · ${s.time} · _${s.evidence}_`);
    s.detail.split("\n").forEach((line) => L.push(`  ${line}`));
    if (s.agent_help) L.push(`  - _Agent can help:_ ${s.agent_help}`);
    s.gotchas.forEach((x) => L.push(`  - ⚠ ${x}`));
  });
  L.push("", "## Review", `- **Required when:** ${g.review.required_when}`, `- **Typical duration:** ${g.review.typical_duration}`, `- **Process:** ${g.review.process}`);
  if (g.review.prepare.length) L.push(`- **Prepare:** ${g.review.prepare.join("; ")}`);
  if (g.scopes.length) {
    L.push("", "## Scopes", "| Scope | Tier | Triggers |", "|---|---|---|");
    g.scopes.forEach((s) => L.push(`| \`${s.scope}\` | ${s.tier} | ${s.review_impact} |`));
  }
  L.push("", "## Blockers");
  g.blockers.forEach((b) => L.push(`- **${b.title}**: _${b.symptom}_ → ${b.fix}`));
  L.push("", "## Agent vs you", "**Agent can:**", ...g.agent_vs_you.agent_can.map((x) => `- ${x}`), "", "**You must:**", ...g.agent_vs_you.you_must.map((x) => `- ${x}`));
  if (g.uncertain.length) L.push("", "## Uncertain", ...g.uncertain.map((x) => `- ${x}`));
  L.push("", "## Sources", ...g.sources.map((s) => `- [${s.id}] [${s.title}](${s.url}) (${s.kind})`));
  if (url) L.push("", `_Live guide: ${url}_`);
  return L.join("\n");
}
