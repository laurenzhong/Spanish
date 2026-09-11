import "server-only";

import { z } from "zod";

import { scenarioGenerationResultSchema, ScenarioProviderError, type ScenarioGenerationInput, type ScenarioGenerationProvider, type ScenarioGenerationResult } from "./scenario-generation";

const defaultEndpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const defaultModelVersion = "MiniMax-M3";
const envelopeSchema = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).min(1) }).passthrough();
const payloadSchema = scenarioGenerationResultSchema.omit({ provider: true, modelVersion: true, providerRequestId: true, latencyMs: true, estimatedCostMicros: true });
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type MiniMaxScenarioGenerationOptions = Readonly<{ apiKey: string; endpoint?: string; modelVersion?: string; timeoutMs?: number; fetchImplementation?: FetchImplementation; clock?: () => number }>;

export class MiniMaxScenarioGenerationProvider implements ScenarioGenerationProvider {
  readonly key = "minimax";
  constructor(private readonly options: MiniMaxScenarioGenerationOptions) {}

  async generate(input: ScenarioGenerationInput, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<ScenarioGenerationResult> {
    if (!this.options.apiKey.trim()) throw new ScenarioProviderError("PROVIDER_NOT_CONFIGURED", "Scenario generation is not configured.", false);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.options.timeoutMs ?? 30_000);
    const abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort(); else options.signal?.addEventListener("abort", abort, { once: true });
    const clock = this.options.clock ?? Date.now;
    const startedAt = clock();
    try {
      const response = await (this.options.fetchImplementation ?? fetch)(this.options.endpoint ?? defaultEndpoint, {
        method: "POST",
        headers: { "anthropic-version": "2023-06-01", "content-type": "application/json", "x-api-key": this.options.apiKey },
        body: JSON.stringify({
          model: this.options.modelVersion ?? defaultModelVersion,
          max_tokens: 1_500,
          thinking: { type: "disabled" },
          stream: false,
          system: [
            "Create one private Spanish roleplay for an adult A1-B2 learner.",
            "Return JSON only with title, setting, openingLine, communicationGoals, conditionChanges, expressions.",
            "communicationGoals and expression translations/intents are concise Simplified Chinese; Spanish lines and expression text/variants are Spanish.",
            "Use the supplied expressions naturally when present. Accept natural alternatives and never require an exact reference sentence.",
            "The temporary character is fictional and must not claim a real listing, venue, meeting, event, or action exists.",
            "Do not include private data, contact details, long source excerpts, scoring, evidence, or long-term character memory.",
            "expressions items contain text, translation, communicativeIntent, variants. Also return temporaryCharacter with displayName, role, locale.",
          ].join(" "),
          messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify({ task: "generate_private_scenario", cefr: input.cefr, locale: input.locale, topic: input.topic, sourceExpressions: input.sourceExpressions.slice(0, 8), privateDraft: true }) }] }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw errorForStatus(response.status);
      const providerRequestId = response.headers.get("x-request-id");
      const envelope = envelopeSchema.safeParse(await response.json().catch(() => null));
      if (!envelope.success) throw invalidResponse();
      const text = envelope.data.content.filter((block) => block.type === "text" && block.text).map((block) => block.text).join("\n").trim();
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { throw invalidResponse(); }
      const parsed = payloadSchema.safeParse(raw);
      if (!parsed.success) throw invalidResponse();
      return { ...parsed.data, provider: this.key, modelVersion: this.options.modelVersion ?? defaultModelVersion, providerRequestId, latencyMs: Math.max(0, clock() - startedAt), estimatedCostMicros: null };
    } catch (error) {
      if (error instanceof ScenarioProviderError) throw error;
      if (timedOut) throw new ScenarioProviderError("provider-timeout", "Scenario generation timed out.", true);
      if (controller.signal.aborted) throw new ScenarioProviderError("provider-cancelled", "Scenario generation was cancelled.", false);
      throw new ScenarioProviderError("provider-unavailable", "Scenario generation is temporarily unavailable.", true);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

export function createMiniMaxScenarioGenerationProvider(options: Partial<MiniMaxScenarioGenerationOptions> = {}) {
  return new MiniMaxScenarioGenerationProvider({ ...options, apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "", endpoint: options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultEndpoint });
}

function invalidResponse() { return new ScenarioProviderError("provider-response-invalid", "Scenario generation returned an invalid response.", false); }
function errorForStatus(status: number) {
  if (status === 401 || status === 403) return new ScenarioProviderError("provider-auth-failed", "Scenario generation authentication failed.", false);
  if (status === 429) return new ScenarioProviderError("provider-rate-limited", "Scenario generation rate limit was reached.", true);
  if (status >= 500) return new ScenarioProviderError("provider-unavailable", "Scenario generation is temporarily unavailable.", true);
  return invalidResponse();
}
