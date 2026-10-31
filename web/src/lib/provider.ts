import "server-only";
import type { AgentEvent } from "./agent";

export type Provider = "anthropic" | "gemini";

/** Claude when ANTHROPIC_API_KEY is set, else Gemini when GEMINI_API_KEY is set. LLM_PROVIDER overrides. */
export function activeProvider(): Provider | null {
  const forced = process.env.LLM_PROVIDER as Provider | undefined;
  if (forced === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (forced === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

export async function* generateGuide(input: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  const p = activeProvider();
  if (p === "anthropic") {
    const { generateGuideClaude } = await import("./agent");
    yield* generateGuideClaude(input, signal);
  } else if (p === "gemini") {
    const { generateGuideGemini } = await import("./agent-gemini");
    yield* generateGuideGemini(input, signal);
  } else {
    yield { type: "error", message: "No model API key configured (set GEMINI_API_KEY or ANTHROPIC_API_KEY)." };
  }
}
