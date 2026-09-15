import type { TranslationProvider } from "../translation";

/** Internal media boundary; it prevents acquisition code from depending on a vendor adapter. */
export type MediaTranslationProvider = TranslationProvider;

export type FakeMediaTranslationOutcome = Awaited<ReturnType<TranslationProvider["translate"]>> | Error | (() => Awaited<ReturnType<TranslationProvider["translate"]>> | Error);

export class FakeMediaTranslationProvider implements MediaTranslationProvider {
  readonly inputs: Parameters<TranslationProvider["translate"]>[0][] = [];

  constructor(private readonly outcome: FakeMediaTranslationOutcome = {
    text: "Hola.", provider: "fake", modelVersion: "fake-v1", providerRequestId: null, latencyMs: 0, estimatedCostMicros: 0,
  }) {}

  async translate(input: Parameters<TranslationProvider["translate"]>[0]): Promise<Awaited<ReturnType<TranslationProvider["translate"]>>> {
    this.inputs.push(input);
    const result = typeof this.outcome === "function" ? this.outcome() : this.outcome;
    if (result instanceof Error) throw result;
    return result;
  }
}

