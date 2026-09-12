import "server-only";

import { OpenAIResponsesClient, type OpenAIResponsesClientOptions } from "../openai/responses-client";
import {
  scenarioEvaluationResultSchema,
  ScenarioProviderError,
  type ScenarioEvaluationInput,
  type ScenarioEvaluationProvider,
  type ScenarioEvaluationResult,
} from "./scenario-evaluation";

const payloadSchema = scenarioEvaluationResultSchema.omit({
  provider: true,
  modelVersion: true,
  providerRequestId: true,
  latencyMs: true,
  estimatedCostMicros: true,
});

export class OpenAIScenarioEvaluationProvider implements ScenarioEvaluationProvider {
  readonly key = "openai";
  private readonly client: OpenAIResponsesClient;

  constructor(options: OpenAIResponsesClientOptions) {
    this.client = new OpenAIResponsesClient(options);
  }

  async evaluate(input: ScenarioEvaluationInput, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<ScenarioEvaluationResult> {
    const result = await this.client.generateText({
      instructions: [
        "Evaluate whether an adult Spanish learner achieved the supplied communication goal in context.",
        "Accept natural alternatives and never require one reference sentence.",
        "Return JSON only with contextualSuccess and errors. Each error has turnId, start, end, category, explanation, affectsUnderstanding, and naturalAlternative.",
        "Do not infer pronunciation or fluency from typing. Low-confidence transcription and technical failures must never become negative oral evidence.",
      ].join(" "),
      input: JSON.stringify({
        communicationGoal: input.communicationGoal,
        modality: input.modality,
        hintLevel: input.hintLevel,
        transcriptConfidence: input.transcriptConfidence,
        completedTurns: input.completedTurns,
      }),
      maxOutputTokens: 700,
    }, options);
    let raw: unknown;
    try { raw = JSON.parse(result.text); } catch { throw invalidResponse(); }
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) throw invalidResponse();
    const userTurns = new Map(input.completedTurns
      .filter((turn) => turn.speaker === "user")
      .map((turn) => [turn.turnId, turn.text]));
    if (parsed.data.errors.some((error) => {
      const source = userTurns.get(error.turnId);
      return !source || error.end > source.length || error.start >= error.end;
    })) throw invalidResponse();
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

export function createOpenAIScenarioEvaluationProvider(
  options: Partial<OpenAIResponsesClientOptions> = {},
) {
  return new OpenAIScenarioEvaluationProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? "",
    endpoint: options.endpoint ?? process.env.OPENAI_API_ENDPOINT,
    modelVersion: options.modelVersion ?? process.env.OPENAI_SCENARIO_EVALUATION_MODEL ?? "gpt-5.6-sol",
  });
}

function invalidResponse() {
  return new ScenarioProviderError("provider-response-invalid", "Scenario evaluation returned an invalid response.", false);
}
