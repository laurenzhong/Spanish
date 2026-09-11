import {
  ScenarioProviderError,
  type ScenarioGenerationInput,
  type ScenarioGenerationProvider,
  type ScenarioGenerationResult,
} from "./scenario-generation";

export class FakeScenarioGenerationProvider implements ScenarioGenerationProvider {
  readonly key = "deterministic-scenario-generation";
  readonly calls: ScenarioGenerationInput[] = [];

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
    this.calls.push(input);
    const expression = input.sourceExpressions[0] ?? "Quisiera pedir, por favor.";
    return {
      title: `Práctica: ${input.topic.trim()}`,
      setting: `Una situación privada para practicar: ${expression}`,
      openingLine: "Hola, ¿en qué puedo ayudarte?",
      communicationGoals: ["礼貌说明你的需要，并确认对方是否理解。"],
      conditionChanges: ["La primera opción no está disponible."],
      expressions: [{
        text: expression,
        translation: "我想礼貌地提出请求。",
        communicativeIntent: "礼貌提出需要",
        variants: ["Me gustaría pedir, por favor."],
      }],
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
