import {
  ScenarioProviderError,
  type ScenarioGenerationInput,
  type ScenarioGenerationProvider,
  type ScenarioGenerationResult,
} from "./scenario-generation";

export class FakeScenarioGenerationProvider implements ScenarioGenerationProvider {
  readonly key = "deterministic-scenario-generation";

  constructor(
    private readonly failure: ScenarioProviderError | null = null,
  ) {}

  async generate(
    input: ScenarioGenerationInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ScenarioGenerationResult> {
    if (options?.signal?.aborted) {
      throw new ScenarioProviderError("provider-cancelled", "Scenario generation was cancelled.", false);
    }
    if (this.failure) throw this.failure;
    const expression = input.sourceExpressions[0] ?? "Quisiera pedir, por favor.";
    return {
      title: `Práctica: ${input.topic.trim()}`,
      setting: `Una situación privada para practicar: ${expression}`,
      communicationGoals: [`Usar ${expression} para completar la petición.`],
      conditionChanges: ["La primera opción no está disponible."],
      temporaryCharacter: {
        displayName: "Carmen",
        role: "interlocutora temporal",
        locale: input.locale,
      },
      provider: this.key,
      modelVersion: "fake-v1",
      providerRequestId: null,
      latencyMs: 0,
      estimatedCostMicros: 0,
    };
  }
}
