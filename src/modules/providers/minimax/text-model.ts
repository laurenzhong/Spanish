import { z } from "zod";

// Verified against MiniMax's model invocation guide on 2026-10-25.
export const DEFAULT_MINIMAX_TEXT_MODEL = "MiniMax-M3.1-Flash";

/** M3.1 requires thinking; low effort bounds latency without requesting an invalid disabled mode. */
export function miniMaxThinkingOptions(modelVersion: string) {
  return modelVersion === DEFAULT_MINIMAX_TEXT_MODEL
    ? { output_config: { effort: "low" as const } }
    : { thinking: { type: "disabled" as const } };
}

/** The output limit includes reasoning. Keep the existing answer budget plus a bounded reserve. */
export function miniMaxOutputBudget(modelVersion: string, answerTokens: number): number {
  return answerTokens + (modelVersion === DEFAULT_MINIMAX_TEXT_MODEL ? 4096 : 0);
}

const thinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string().optional(),
});

/** Discard only valid reasoning blocks; malformed/unknown blocks still fail the caller's schema. */
export function discardMiniMaxThinkingBlocks(value: unknown): unknown {
  return Array.isArray(value)
    ? value.filter((block) => !thinkingBlockSchema.safeParse(block).success)
    : value;
}
