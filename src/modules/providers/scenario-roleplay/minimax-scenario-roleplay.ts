import "server-only";

import { z } from "zod";

import {
  ScenarioProviderError,
  type ScenarioRoleplayInput,
  type ScenarioRoleplayProvider,
  type ScenarioRoleplayStreamEvent,
} from "./scenario-roleplay";

const defaultEndpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const defaultModelVersion = "MiniMax-M3";
const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).min(1),
}).passthrough();

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type MiniMaxScenarioRoleplayOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  modelVersion?: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
}>;

export class MiniMaxScenarioRoleplayProvider implements ScenarioRoleplayProvider {
  readonly key = "minimax";

  constructor(private readonly options: MiniMaxScenarioRoleplayOptions) {}

  async *stream(
    input: ScenarioRoleplayInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): AsyncIterable<ScenarioRoleplayStreamEvent> {
    if (!this.options.apiKey.trim()) {
      throw new ScenarioProviderError("PROVIDER_NOT_CONFIGURED", "Scenario roleplay is not configured.", false);
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.options.timeoutMs ?? 30_000);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();

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
          max_tokens: 300,
          thinking: { type: "disabled" },
          stream: false,
          system: [
            "Act as the temporary Spanish-speaking counterpart in a language practice scenario.",
            "First respond naturally to the learner's complete message. Never interrupt, correct, grade, or mention a reference answer.",
            "Keep the reply to one or two concise conversational sentences in Spanish and stay inside the supplied scenario.",
            "Use a supplied condition only when it appears in conditionSnapshot; never invent a goal completion state.",
            "This character is temporary. Do not claim memories, a continuing relationship, real contact details, or an actual offline appointment.",
            "Any rental listing, viewing, location, price, or appointment is fictional practice material and must never be presented as verified reality.",
            "If asked whether you are AI, answer truthfully. Return only the character reply.",
          ].join(" "),
          messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify({
            temporaryCharacter: input.temporaryCharacter,
            communicationGoal: input.communicationGoal,
            activeConditions: input.conditionSnapshot,
            completedTurns: input.completedTurns,
          }) }] }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw statusError(response.status);
      const parsed = responseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw invalidResponse();
      const text = parsed.data.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (!text || text.length > 1_000) throw invalidResponse();
      yield { type: "delta", generationId: input.generationId, text };
      yield { type: "done", generationId: input.generationId };
    } catch (error) {
      if (error instanceof ScenarioProviderError) throw error;
      if (timedOut) throw new ScenarioProviderError("provider-timeout", "Scenario roleplay timed out.", true);
      if (controller.signal.aborted) throw new ScenarioProviderError("provider-cancelled", "Scenario roleplay was cancelled.", false);
      throw new ScenarioProviderError("provider-unavailable", "Scenario roleplay is temporarily unavailable.", true);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

export function createMiniMaxScenarioRoleplayProvider(
  options: Partial<MiniMaxScenarioRoleplayOptions> = {},
): MiniMaxScenarioRoleplayProvider {
  return new MiniMaxScenarioRoleplayProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
    endpoint: options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultEndpoint,
  });
}

function invalidResponse() {
  return new ScenarioProviderError("provider-response-invalid", "Scenario roleplay returned an invalid response.", false);
}

function statusError(status: number) {
  if (status === 401 || status === 403) return new ScenarioProviderError("provider-auth-failed", "Scenario roleplay authentication failed.", false);
  if (status === 429) return new ScenarioProviderError("provider-rate-limited", "Scenario roleplay rate limit was reached.", true);
  if (status >= 500) return new ScenarioProviderError("provider-unavailable", "Scenario roleplay is temporarily unavailable.", true);
  return invalidResponse();
}
