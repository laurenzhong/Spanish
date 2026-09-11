import "server-only";

import { z } from "zod";

import {
  scenarioEvaluationResultSchema,
  ScenarioProviderError,
  type ScenarioEvaluationInput,
  type ScenarioEvaluationProvider,
  type ScenarioEvaluationResult,
} from "./scenario-evaluation";

const defaultEndpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const defaultModelVersion = "MiniMax-M3";
const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).min(1),
}).passthrough();
const payloadSchema = scenarioEvaluationResultSchema.omit({
  provider: true,
  modelVersion: true,
  providerRequestId: true,
  latencyMs: true,
  estimatedCostMicros: true,
});

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type MiniMaxScenarioEvaluationOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  modelVersion?: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
  clock?: () => number;
}>;

export class MiniMaxScenarioEvaluationProvider implements ScenarioEvaluationProvider {
  readonly key = "minimax";

  constructor(private readonly options: MiniMaxScenarioEvaluationOptions) {}

  async evaluate(input: ScenarioEvaluationInput, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<ScenarioEvaluationResult> {
    if (!this.options.apiKey.trim()) {
      throw new ScenarioProviderError("PROVIDER_NOT_CONFIGURED", "Scenario evaluation is not configured.", false);
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.options.timeoutMs ?? 30_000);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const clock = this.options.clock ?? Date.now;
    const startedAt = clock();

    try {
      const response = await (this.options.fetchImplementation ?? fetch)(this.options.endpoint ?? defaultEndpoint, {
        method: "POST",
        headers: {
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "x-api-key": this.options.apiKey,
        },
        body: JSON.stringify({
          model: this.options.modelVersion ?? defaultModelVersion,
          max_tokens: 700,
          thinking: { type: "disabled" },
          stream: false,
          system: [
            "Evaluate whether an adult Spanish learner achieved the supplied communication goal in context.",
            "Accept natural alternatives; never require one reference sentence.",
            "Return JSON only: contextualSuccess and errors. Each error must have turnId, start, end, category, explanation, affectsUnderstanding, naturalAlternative.",
            "Explain whether each issue affects understanding. Do not infer pronunciation or fluency from typing.",
            "Low-confidence transcripts and technical failures must not become negative oral evidence.",
          ].join(" "),
          messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify({
            communicationGoal: input.communicationGoal,
            modality: input.modality,
            hintLevel: input.hintLevel,
            transcriptConfidence: input.transcriptConfidence,
            completedTurns: input.completedTurns,
          }) }] }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw statusError(response.status);
      const providerRequestId = response.headers.get("x-request-id");
      const envelope = responseSchema.safeParse(await response.json().catch(() => null));
      if (!envelope.success) throw invalidResponse();
      const text = envelope.data.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim();
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { throw invalidResponse(); }
      const parsed = payloadSchema.safeParse(raw);
      if (!parsed.success) throw invalidResponse();
      const userTurns = new Map(input.completedTurns.filter((turn) => turn.speaker === "user").map((turn) => [turn.turnId, turn.text]));
      if (parsed.data.errors.some((error) => {
        const source = userTurns.get(error.turnId);
        return !source || error.end > source.length || error.start >= error.end;
      })) throw invalidResponse();
      return {
        ...parsed.data,
        provider: this.key,
        modelVersion: this.options.modelVersion ?? defaultModelVersion,
        providerRequestId,
        latencyMs: Math.max(0, clock() - startedAt),
        estimatedCostMicros: null,
      };
    } catch (error) {
      if (error instanceof ScenarioProviderError) throw error;
      if (timedOut) throw new ScenarioProviderError("provider-timeout", "Scenario evaluation timed out.", true);
      if (controller.signal.aborted) throw new ScenarioProviderError("provider-cancelled", "Scenario evaluation was cancelled.", false);
      throw new ScenarioProviderError("provider-unavailable", "Scenario evaluation is temporarily unavailable.", true);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

export function createMiniMaxScenarioEvaluationProvider(
  options: Partial<MiniMaxScenarioEvaluationOptions> = {},
): MiniMaxScenarioEvaluationProvider {
  return new MiniMaxScenarioEvaluationProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
    endpoint: options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultEndpoint,
  });
}

function invalidResponse() {
  return new ScenarioProviderError("provider-response-invalid", "Scenario evaluation returned an invalid response.", false);
}

function statusError(status: number) {
  if (status === 401 || status === 403) return new ScenarioProviderError("provider-auth-failed", "Scenario evaluation authentication failed.", false);
  if (status === 429) return new ScenarioProviderError("provider-rate-limited", "Scenario evaluation rate limit was reached.", true);
  if (status >= 500) return new ScenarioProviderError("provider-unavailable", "Scenario evaluation is temporarily unavailable.", true);
  return invalidResponse();
}
