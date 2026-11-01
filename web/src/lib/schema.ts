import { z } from "zod";

/**
 * Evidence level for any claim in a guide.
 * - tested:   a human or agent actually performed this in the provider console / against the API
 * - sourced:  stated in an official provider doc (or reputable source) that is cited
 * - inferred: reasoned from indirect evidence; treat as a hypothesis
 */
export const Evidence = z.enum(["tested", "sourced", "inferred"]);

export const Owner = z.enum(["agent", "you", "wait"]);

export const Source = z.object({
  id: z.string().describe("short id like s1, s2"),
  title: z.string(),
  url: z.string(),
  kind: z.enum(["official", "community", "tested"]),
});

export const Step = z.object({
  title: z.string(),
  phase: z.enum(["prepare", "register", "configure", "test", "review", "launch"]),
  owner: Owner.describe(
    "agent = an agent can do this for you (drafting, generating config, looking things up); you = needs a human (login, legal, payment, identity, video); wait = calendar time waiting on the provider",
  ),
  time: z.string().describe("hands-on time or wait, e.g. '10 min', '3–10 business days'"),
  detail: z.string().describe("concrete instructions, markdown allowed; name exact console menus and fields"),
  agent_help: z.string().nullable().describe("what an agent can produce to speed up this step, or null"),
  gotchas: z.array(z.string()),
  evidence: Evidence,
  source_ids: z.array(z.string()),
});

export const Scope = z.object({
  scope: z.string(),
  purpose: z.string(),
  tier: z.enum(["basic", "sensitive", "restricted", "partner-only", "unknown"]),
  review_impact: z.string().describe("what using this scope triggers, e.g. 'none', 'app review', 'CASA security assessment'"),
});

export const Blocker = z.object({
  title: z.string(),
  symptom: z.string().describe("what the developer sees, e.g. an error message"),
  fix: z.string(),
  evidence: Evidence,
});

export const Guide = z.object({
  slug: z.string(),
  name: z.string(),
  website: z.string(),
  category: z.string(),
  summary: z.string().describe("2–3 sentences: what it takes, the main catch"),

  verdict: z.object({
    difficulty: z.number().int().min(1).max(5).describe("1 = instant self-serve, 5 = partner-gated/contract"),
    label: z.enum(["Instant", "Easy", "Moderate", "Hard", "Gated"]),
    hands_on: z.string().describe("SHORT (max ~20 chars): total developer hands-on time, e.g. '20–40 min', '1–2 days'"),
    calendar: z.string().describe("SHORT (max ~20 chars): realistic calendar time to production incl. review waits, e.g. 'same day', '4–8 weeks'"),
    time_note: z.string().describe("1–2 sentences explaining what drives the hands-on and calendar estimates and how they vary by path/scopes"),
    approval: z.enum(["none", "to-go-public", "always", "partner-contract"]),
    headline_blocker: z.string().describe("the single thing most likely to slow you down"),
    evidence: Evidence,
  }),

  stages: z
    .array(
      z.object({
        name: z.string().describe("e.g. 'Development / testing', 'Production (unverified)', 'Production (verified)'"),
        what_you_get: z.string().describe("limits: user caps, warning screens, who can connect"),
        how_to_reach: z.string(),
      }),
    )
    .describe("the ladder from a test app to a production-ready app"),

  managed_alternative: z.object({
    composio_managed: z.boolean().nullable().describe("is a Composio-managed OAuth app listed for this toolkit; null if unknown"),
    note: z.string().describe("when the managed app is fine vs when you need your own (branding, scopes, rate limits)"),
  }),

  oauth: z.object({
    console_url: z.string().nullable(),
    docs_url: z.string().nullable(),
    authorize_url: z.string().nullable(),
    token_url: z.string().nullable(),
    redirect_uri_rules: z.string().describe("https required? localhost allowed? exact match? how many?"),
    pkce: z.string().describe("required / supported / not supported / unknown"),
    refresh_tokens: z.string().describe("issued? rotation? expiry of access/refresh tokens"),
    notes: z.array(z.string()),
  }),

  steps: z.array(Step),
  scopes: z.array(Scope),

  review: z.object({
    required_when: z.string(),
    process: z.string(),
    typical_duration: z.string(),
    prepare: z.array(z.string()).describe("artifacts to have ready: privacy policy URL, demo video, domain verification…"),
    common_rejections: z.array(z.string()),
    evidence: Evidence,
  }),

  blockers: z.array(Blocker),

  agent_vs_you: z.object({
    agent_can: z.array(z.string()),
    you_must: z.array(z.string()),
  }),

  uncertain: z.array(z.string()).describe("claims we could not verify or that vary case-by-case"),
  sources: z.array(Source),
});

export type Guide = z.infer<typeof Guide>;

/** Metadata wrapped around a guide when stored. */
export type StoredGuide = Guide & {
  meta: {
    origin: "curated" | "generated";
    generated_at: string;
    model?: string;
    /** provider logo (directory logo or site favicon); not written by the model */
    logo?: string | null;
    /** raw research notes from the live agent, kept for auditability */
    dossier?: string;
    verification?: {
      date: string;
      method: string;
      /** "independent": a separate agent re-checked a curated draft; "automated": the post-generation verifier. Missing = independent. */
      kind?: "independent" | "automated";
      model?: string;
      findings: { claim: string; result: "confirmed" | "corrected" | "unverified"; note: string; quote?: string }[];
    };
    /** deterministic post-generation checks (links, endpoints, consistency, catalog, usability) */
    checks?: AutoChecks;
    /** set when a generated guide was promoted into the curated set by scripts/promote-guide.ts */
    promoted?: { date: string; from: string; forced?: boolean };
  };
};

export type CheckGroup = "links" | "endpoints" | "consistency" | "catalog" | "usability" | "claims";
export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export type CheckResult = {
  id: string;
  group: CheckGroup;
  label: string;
  status: CheckStatus;
  detail: string;
  url?: string;
};
export type AutoChecks = {
  date: string;
  duration_ms: number;
  results: CheckResult[];
  summary: Record<CheckStatus, number>;
  /** edits the verifier applied to the guide, in plain words */
  applied: string[];
};
