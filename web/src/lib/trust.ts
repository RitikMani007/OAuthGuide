import type { StoredGuide } from "./schema";

// One trust status for every guide, curated or generated, computed from the same four
// rules. "Verified" is earned by evidence on the guide, never by where it is stored.

export type TrustLevel = "verified" | "checked" | "unchecked";
export type TrustRule = { id: string; label: string; ok: boolean; detail: string };
export type Trust = { level: TrustLevel; rules: TrustRule[]; date: string | null; kind: "independent" | "automated" | null };

export const TRUST_LABEL: Record<TrustLevel, string> = { verified: "Verified", checked: "Checked", unchecked: "Unchecked" };
export const TRUST_BLURB: Record<TrustLevel, string> = {
  verified: "Automated checks passed with no failures and a second pass confirmed its key claims.",
  checked: "Automated checks ran, but at least one trust rule is not met yet.",
  unchecked: "The automated checks have not run on this guide.",
};

export function guideTrust(g: StoredGuide): Trust {
  const c = g.meta.checks;
  const v = g.meta.verification;
  const n = (r: "confirmed" | "corrected" | "unverified") => (v ? v.findings.filter((f) => f.result === r).length : 0);
  const confirmed = n("confirmed");
  const unverified = n("unverified");
  const rules: TrustRule[] = [
    { id: "checks", label: "Automated checks ran", ok: !!c, detail: c ? `${c.results.length} checks on ${c.date}.` : "Not run yet." },
    { id: "no_fail", label: "No failed check", ok: !!c && c.summary.fail === 0, detail: c ? (c.summary.fail ? `${c.summary.fail} failed: ${c.results.filter((r) => r.status === "fail").map((r) => r.label).slice(0, 3).join(", ")}.` : `${c.summary.pass} passed, ${c.summary.warn} warnings.`) : "Needs the checks first." },
    { id: "claims", label: "Key claims re-checked by a second pass", ok: !!v, detail: v ? `${v.findings.length} claims re-checked on ${v.date} (${(v.kind ?? "independent") === "independent" ? "independent agent" : "automated, a model that did not write the guide"}).` : "No claim re-check yet." },
    { id: "confirmed", label: "More claims confirmed than left unverified", ok: !!v && confirmed > 0 && confirmed >= unverified, detail: v ? `${confirmed} confirmed, ${n("corrected")} corrected in place, ${unverified} unverified.` : "Needs the claim re-check first." },
  ];
  const level: TrustLevel = rules.every((r) => r.ok) ? "verified" : c ? "checked" : "unchecked";
  const date = [c?.date, v?.date].filter((d): d is string => !!d).sort().pop() ?? null;
  return { level, rules, date, kind: v ? (v.kind ?? "independent") : null };
}
