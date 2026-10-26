import { z } from "zod";
import { discardMiniMaxThinkingBlocks, miniMaxThinkingOptions } from "../../src/modules/providers/minimax/text-model";
import type { EvaluationHttpExecutor } from "./real-provider";
import type { LanguageQualityReviewer } from "./language-quality";

const endpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const model = "MiniMax-M3.1-Flash";
const responseSchema = z.object({
  stop_reason: z.literal("end_turn"),
  content: z.preprocess(discardMiniMaxThinkingBlocks, z.array(z.object({ type: z.literal("text"), text: z.string() }).strict()).min(1)),
}).passthrough();

/** Adapter only; authentication, budget reservation and request auditing belong to the caller's transport. */
export function createMiniMaxLanguageQualityReviewer(execute: EvaluationHttpExecutor): LanguageQualityReviewer {
  return async (_input, prompt, signal) => {
    if (signal?.aborted) throw new Error("LANGUAGE_REVIEW_CANCELLED");
    const response = await execute({ role: "reviewer", input: endpoint, init: {
      method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 5596, ...miniMaxThinkingOptions(model), stream: false,
        system: prompt, messages: [{ role: "user", content: [{ type: "text", text: "按固定 rubric 评审上面的可见材料，只输出 JSON。" }] }] }),
      signal,
    } });
    if (signal?.aborted) throw new Error("LANGUAGE_REVIEW_CANCELLED");
    if (!response.ok) throw new Error("LANGUAGE_REVIEW_HTTP_FAILED");
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error("LANGUAGE_REVIEW_RESPONSE_INVALID"); }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) throw new Error("LANGUAGE_REVIEW_RESPONSE_INVALID");
    const text = parsed.data.content.map((block) => block.text).join("\n").trim();
    try { return JSON.parse(text) as unknown; } catch { throw new Error("LANGUAGE_REVIEW_JSON_INVALID"); }
  };
}

