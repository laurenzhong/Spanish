import "server-only";

import { OpenAIResponsesClient, type OpenAIResponsesClientOptions } from "../openai/responses-client";
import {
  ScenarioProviderError,
  type ScenarioRoleplayInput,
  type ScenarioRoleplayProvider,
  type ScenarioRoleplayStreamEvent,
} from "./scenario-roleplay";

export class OpenAIScenarioRoleplayProvider implements ScenarioRoleplayProvider {
  readonly key = "openai";
  readonly modelVersion: string;
  private readonly client: OpenAIResponsesClient;

  constructor(options: OpenAIResponsesClientOptions) {
    this.client = new OpenAIResponsesClient(options);
    this.modelVersion = this.client.modelVersion;
  }

  async *stream(input: ScenarioRoleplayInput, options: Readonly<{ signal?: AbortSignal }> = {}): AsyncIterable<ScenarioRoleplayStreamEvent> {
    const result = await this.client.generateText({
      instructions: [
        "Act as the temporary Spanish-speaking counterpart in a language practice scenario.",
        "Respond naturally to the learner's complete message before any teaching opportunity. Never interrupt, correct, grade, or demand an exact phrase.",
        "Reply with one or two concise conversational sentences in Spanish and remain inside the supplied fictional scenario.",
        "Never claim memories, a continuing relationship, real contact details, a verified listing or venue, or an actual offline appointment.",
        "If asked whether you are AI, answer truthfully. Return only the character reply.",
      ].join(" "),
      input: JSON.stringify({
        temporaryCharacter: input.temporaryCharacter,
        communicationGoal: input.communicationGoal,
        activeConditions: input.conditionSnapshot,
        completedTurns: input.completedTurns,
      }),
      maxOutputTokens: 300,
    }, options);
    if (!result.text || result.text.length > 1_000) {
      throw new ScenarioProviderError("provider-response-invalid", "Scenario roleplay returned an invalid response.", false);
    }
    yield { type: "delta", generationId: input.generationId, text: result.text };
    yield { type: "done", generationId: input.generationId };
  }
}

export function createOpenAIScenarioRoleplayProvider(
  options: Partial<OpenAIResponsesClientOptions> = {},
) {
  return new OpenAIScenarioRoleplayProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? "",
    endpoint: options.endpoint ?? process.env.OPENAI_API_ENDPOINT,
    modelVersion: options.modelVersion ?? process.env.OPENAI_SCENARIO_ROLEPLAY_MODEL ?? "gpt-5.6-sol",
  });
}
