import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { observeScenarioGenerationProvider } from "@/src/modules/providers/observed-scenario-providers";
import { executeWithScenarioProviderFallback } from "@/src/modules/providers/routing/provider-fallback";
import { ScenarioProviderError } from "@/src/modules/providers/routing/scenario-provider-router";
import type { ProviderCallObservation } from "@/src/shared/observability";

describe("observed scenario providers", () => {
  it("records the failed primary and successful fallback as separate sanitized calls", async () => {
    const observations: ProviderCallObservation[] = [];
    const observer = { record: async (input: ProviderCallObservation) => { observations.push(input); } };
    const primary = observeScenarioGenerationProvider({
      key: "minimax",
      generate: async () => { throw new ScenarioProviderError("provider-timeout", "private raw provider detail", true); },
    }, observer, "user-1");
    const fallback = observeScenarioGenerationProvider({
      key: "openai",
      generate: async () => ({
        title: "药店",
        setting: "虚构药店",
        openingLine: "Buenas.",
        communicationGoals: ["询问用法"],
        conditionChanges: [],
        expressions: [{ text: "¿Cómo se toma?", translation: "怎么服用？", communicativeIntent: "询问用法", variants: [] }],
        temporaryCharacter: { displayName: "Ana", role: "farmacéutica", locale: "es-ES" },
        provider: "openai",
        modelVersion: "test-model",
        providerRequestId: "request-safe",
        latencyMs: 12,
        estimatedCostMicros: null,
      }),
    }, observer, "user-1");
    await executeWithScenarioProviderFallback({
      providers: [primary, fallback],
      execute: (provider) => provider.generate({ requestId: "request-1", generationId: "generation-1", locale: "es-ES", cefr: "A2", topic: "sensitive topic", sourceExpressions: ["private expression"] }),
    });
    expect(observations.map((item) => [item.provider, item.status, item.errorType])).toEqual([
      ["minimax", "failed", "provider-timeout"],
      ["openai", "succeeded", undefined],
    ]);
    expect(JSON.stringify(observations)).not.toContain("private raw provider detail");
    expect(JSON.stringify(observations)).not.toContain("private expression");
  });
});
