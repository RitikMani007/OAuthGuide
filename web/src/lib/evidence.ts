import type { Guide } from "./schema";

/**
 * Models over-claim. "tested" is only allowed where a claim cites a source of
 * kind "tested" (a live probe); everything else is capped at "sourced", and
 * "sourced" without any resolvable citation becomes "inferred".
 */
export function enforceEvidence(g: Guide): Guide {
  const kind = new Map(g.sources.map((s) => [s.id, s.kind]));
  const cap = (e: Guide["verdict"]["evidence"], ids?: string[]) => {
    if (!ids) return e === "tested" ? "sourced" : e; // fields without citations
    const resolved = ids.filter((id) => kind.has(id));
    if (e === "tested" && !resolved.some((id) => kind.get(id) === "tested")) return resolved.length ? "sourced" : "inferred";
    if (e === "sourced" && !resolved.length) return "inferred";
    return e;
  };
  return {
    ...g,
    verdict: { ...g.verdict, evidence: cap(g.verdict.evidence) },
    review: { ...g.review, evidence: cap(g.review.evidence) },
    blockers: g.blockers.map((b) => ({ ...b, evidence: cap(b.evidence) })),
    steps: g.steps.map((s) => ({ ...s, evidence: cap(s.evidence, s.source_ids) })),
  };
}
