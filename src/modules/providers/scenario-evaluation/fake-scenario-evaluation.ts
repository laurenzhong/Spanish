import {
  ScenarioProviderError,
  type ScenarioEvaluationInput,
  type ScenarioEvaluationProvider,
  type ScenarioEvaluationResult,
} from "./scenario-evaluation";

export class FakeScenarioEvaluationProvider implements ScenarioEvaluationProvider {
  readonly key = "deterministic-scenario-evaluation";

  constructor(
    private readonly failure: ScenarioProviderError | null = null,
  ) {}

  async evaluate(
    input: ScenarioEvaluationInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ScenarioEvaluationResult> {
    if (options?.signal?.aborted) {
      throw new ScenarioProviderError("provider-cancelled", "Evaluation was cancelled.", false);
    }
    if (this.failure) throw this.failure;
    const userTurn = [...input.completedTurns].reverse().find((turn) => turn.speaker === "user");
    return {
      contextualSuccess: Boolean(userTurn?.text.trim()),
      errors: [],
      provider: this.key,
      modelVersion: "fake-v1",
      providerRequestId: null,
      latencyMs: 0,
      estimatedCostMicros: 0,
    };
  }
}
