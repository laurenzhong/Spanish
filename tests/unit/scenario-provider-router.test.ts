import { describe, expect, it } from "vitest";

import {
  ScenarioProviderError,
  ScenarioProviderRouter,
  shouldFallbackScenarioProvider,
} from "@/src/modules/providers/routing/scenario-provider-router";
import { FakeScenarioGenerationProvider } from "@/src/modules/providers/scenario-generation";
import { FakeScenarioRoleplayProvider } from "@/src/modules/providers/scenario-roleplay";
import { FakeScenarioEvaluationProvider } from "@/src/modules/providers/scenario-evaluation";

const registry = [
  {
    key: "fake-primary",
    capabilities: ["scenario-roleplay", "scenario-evaluation"] as const,
    healthy: true,
  },
  {
    key: "fake-secondary",
    capabilities: ["scenario-generation", "scenario-roleplay", "scenario-evaluation"] as const,
    healthy: true,
  },
  {
    key: "fake-unhealthy",
    capabilities: ["scenario-roleplay"] as const,
    healthy: false,
  },
];

describe("scenario provider router", () => {
  it("uses a healthy configured preference and otherwise the first healthy provider", () => {
    const router = new ScenarioProviderRouter(registry);
    expect(
      router.selectPrimary("scenario-roleplay", {
        "scenario-roleplay": "fake-secondary",
      }).key,
    ).toBe("fake-secondary");
    expect(router.selectPrimary("scenario-generation", {}).key).toBe("fake-secondary");
  });

  it("returns PROVIDER_NOT_CONFIGURED when no healthy provider supports the capability", () => {
    const router = new ScenarioProviderRouter([
      { key: "only-unhealthy", capabilities: ["scenario-roleplay"], healthy: false },
    ]);
    expect(() => router.selectPrimary("scenario-roleplay", {})).toThrowError(
      expect.objectContaining<Partial<ScenarioProviderError>>({
        code: "PROVIDER_NOT_CONFIGURED",
        retryable: false,
      }),
    );
  });

  it("allows at most one fallback and never switches after a visible roleplay delta", () => {
    const router = new ScenarioProviderRouter(registry);
    expect(
      router.selectFallback({
        attemptedProviderKeys: ["fake-primary"],
        capability: "scenario-roleplay",
        hasVisibleDelta: false,
      })?.key,
    ).toBe("fake-secondary");
    expect(
      router.selectFallback({
        attemptedProviderKeys: ["fake-primary", "fake-secondary"],
        capability: "scenario-roleplay",
        hasVisibleDelta: false,
      }),
    ).toBeNull();
    expect(
      router.selectFallback({
        attemptedProviderKeys: ["fake-primary"],
        capability: "scenario-roleplay",
        hasVisibleDelta: true,
      }),
    ).toBeNull();
  });

  it("does not fallback after cancellation but does for a retryable pre-delta failure", () => {
    expect(
      shouldFallbackScenarioProvider(
        new ScenarioProviderError("provider-cancelled", "Cancelled", false),
        { attempts: 1, hasVisibleDelta: false },
      ),
    ).toBe(false);
    expect(
      shouldFallbackScenarioProvider(
        new ScenarioProviderError("provider-timeout", "Timed out", true),
        { attempts: 1, hasVisibleDelta: false },
      ),
    ).toBe(true);
    expect(
      shouldFallbackScenarioProvider(
        new ScenarioProviderError("provider-timeout", "Timed out", true),
        { attempts: 1, hasVisibleDelta: true },
      ),
    ).toBe(false);
  });

  it("keeps deterministic fakes local, cancellable, and explicit about done", async () => {
    const generation = new FakeScenarioGenerationProvider();
    const generated = await generation.generate({
      requestId: "request-1",
      generationId: "generation-1",
      locale: "es-ES",
      cefr: "A2",
      topic: "restaurante",
      sourceExpressions: ["Quisiera la sopa."],
    });
    expect(generated).toMatchObject({
      provider: "deterministic-scenario-generation",
      estimatedCostMicros: 0,
    });

    const input = {
      requestId: "request-2",
      sessionId: "session-1",
      generationId: "generation-2",
      temporaryCharacter: { displayName: "Carmen", role: "camarera", locale: "es-ES" },
      communicationGoal: "Pedir una comida.",
      conditionSnapshot: [],
      completedTurns: [{ speaker: "user" as const, text: "Quisiera la sopa." }],
    };
    const completeEvents = [];
    for await (const event of new FakeScenarioRoleplayProvider("complete").stream(input)) {
      completeEvents.push(event);
    }
    expect(completeEvents.map((event) => event.type)).toEqual(["delta", "done"]);
    const incompleteEvents = [];
    for await (const event of new FakeScenarioRoleplayProvider("incomplete").stream(input)) {
      incompleteEvents.push(event);
    }
    expect(incompleteEvents.map((event) => event.type)).toEqual(["delta"]);

    const controller = new AbortController();
    controller.abort();
    const cancelled = new FakeScenarioRoleplayProvider().stream(input, { signal: controller.signal });
    await expect(cancelled[Symbol.asyncIterator]().next()).rejects.toThrowError(
      expect.objectContaining<Partial<ScenarioProviderError>>({ code: "provider-cancelled" }),
    );

    const evaluation = await new FakeScenarioEvaluationProvider().evaluate({
      requestId: "request-3",
      sessionId: "session-1",
      generationId: "generation-3",
      communicationGoal: "Pedir una comida.",
      modality: "typing",
      hintLevel: 0,
      transcriptConfidence: null,
      completedTurns: [{ turnId: "turn-1", speaker: "user", text: "¿Me pone la sopa?" }],
    });
    expect(evaluation).toMatchObject({ contextualSuccess: true, errors: [] });
  });
});
