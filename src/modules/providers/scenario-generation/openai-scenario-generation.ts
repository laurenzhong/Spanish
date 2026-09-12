import "server-only";

import { OpenAIResponsesClient, type OpenAIResponsesClientOptions } from "../openai/responses-client";
import {
  scenarioGenerationResultSchema,
  ScenarioProviderError,
  type ScenarioGenerationInput,
  type ScenarioGenerationProvider,
  type ScenarioGenerationResult,
} from "./scenario-generation";

const payloadSchema = scenarioGenerationResultSchema.omit({
  provider: true,
  modelVersion: true,
  providerRequestId: true,
  latencyMs: true,
  estimatedCostMicros: true,
});

export class OpenAIScenarioGenerationProvider implements ScenarioGenerationProvider {
  readonly key = "openai";
  private readonly client: OpenAIResponsesClient;

  constructor(options: OpenAIResponsesClientOptions) {
    this.client = new OpenAIResponsesClient(options);
  }

  async generate(input: ScenarioGenerationInput, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<ScenarioGenerationResult> {
    const result = await this.client.generateText({
      instructions: [
        "Create one private Spanish roleplay for an adult A1-B2 learner.",
        "Return JSON only with title, setting, openingLine, communicationGoals, conditionChanges, expressions, and temporaryCharacter.",
        "Chinese learning explanations must be concise. Spanish dialogue and expression variants must be natural Spanish.",
        "Accept natural alternatives and never require one exact reference sentence.",
        "The temporary character and all locations, listings, events, prices, meetings, or actions are fictional practice material.",
        "Do not include private data, scoring, evidence, or long-term character memory.",
      ].join(" "),
      input: JSON.stringify({
        task: "generate_private_scenario",
        cefr: input.cefr,
        locale: input.locale,
        topic: input.topic,
        sourceExpressions: input.sourceExpressions.slice(0, 8),
        privateDraft: true,
      }),
      maxOutputTokens: 1_500,
    }, options);
    let raw: unknown;
    try { raw = JSON.parse(result.text); } catch { throw invalidResponse(); }
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) throw invalidResponse();
    return {
      ...parsed.data,
      provider: this.key,
      modelVersion: this.client.modelVersion,
      providerRequestId: result.providerRequestId,
      latencyMs: result.latencyMs,
      estimatedCostMicros: null,
    };
  }
}

export function createOpenAIScenarioGenerationProvider(
  options: Partial<OpenAIResponsesClientOptions> = {},
) {
  return new OpenAIScenarioGenerationProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? "",
    endpoint: options.endpoint ?? process.env.OPENAI_API_ENDPOINT,
    modelVersion: options.modelVersion ?? process.env.OPENAI_SCENARIO_GENERATION_MODEL ?? "gpt-5.6-sol",
  });
}

function invalidResponse() {
  return new ScenarioProviderError("provider-response-invalid", "Scenario generation returned an invalid response.", false);
}
