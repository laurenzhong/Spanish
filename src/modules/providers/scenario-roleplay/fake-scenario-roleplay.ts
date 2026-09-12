import {
  ScenarioProviderError,
  type ScenarioRoleplayInput,
  type ScenarioRoleplayProvider,
  type ScenarioRoleplayStreamEvent,
} from "./scenario-roleplay";

export class FakeScenarioRoleplayProvider implements ScenarioRoleplayProvider {
  readonly key = "deterministic-scenario-roleplay";
  readonly modelVersion = "fake-v1";

  constructor(
    private readonly behavior: "complete" | "incomplete" | "timeout" = "complete",
  ) {}

  async *stream(
    input: ScenarioRoleplayInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): AsyncIterable<ScenarioRoleplayStreamEvent> {
    if (options?.signal?.aborted) {
      throw new ScenarioProviderError("provider-cancelled", "Roleplay was cancelled.", false);
    }
    if (this.behavior === "timeout") {
      throw new ScenarioProviderError("provider-timeout", "Roleplay timed out.", true);
    }
    yield {
      type: "delta",
      generationId: input.generationId,
      text: "Perfecto. ¿Quiere algo más?",
    };
    if (this.behavior === "complete") {
      yield { type: "done", generationId: input.generationId };
    }
  }
}
