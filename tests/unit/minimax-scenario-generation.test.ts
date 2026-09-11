// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MiniMaxScenarioGenerationProvider } from "@/src/modules/providers/scenario-generation/server";
import { ScenarioProviderError } from "@/src/modules/providers/scenario-generation";

const input = { requestId: "request-1", generationId: "generation-1", locale: "es-ES" as const, cefr: "A2" as const, topic: "在药店询问用法", sourceExpressions: ["¿Cómo debo tomarlo?"] };

describe("MiniMaxScenarioGenerationProvider", () => {
  it("converts a validated JSON response to the internal provider result", async () => {
    const fetchImplementation = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => { void _input; void _init; return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({
      title: "En la farmacia", setting: "Una farmacia ficticia", openingLine: "Hola, ¿en qué puedo ayudarle?",
      communicationGoals: ["说明需要并询问用法"], conditionChanges: ["Este medicamento requiere otra presentación."],
      expressions: [{ text: "¿Cómo debo tomarlo?", translation: "我应该怎么服用？", communicativeIntent: "询问用法", variants: ["¿Cada cuánto debo tomarlo?"] }],
      temporaryCharacter: { displayName: "Elena", role: "farmacéutica", locale: "es-ES" },
    }) }] }), { status: 200, headers: { "x-request-id": "provider-1" } }); });
    const provider = new MiniMaxScenarioGenerationProvider({ apiKey: "test-key", fetchImplementation, clock: (() => { let value = 10; return () => value += 5; })() });
    await expect(provider.generate(input)).resolves.toMatchObject({ provider: "minimax", modelVersion: "MiniMax-M3", providerRequestId: "provider-1", title: "En la farmacia" });
    const body = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as { messages: Array<{ content: Array<{ text: string }> }> };
    expect(body.messages[0]?.content[0]?.text).not.toContain("test-key");
  });

  it("rejects malformed provider output without returning a partial scenario", async () => {
    const provider = new MiniMaxScenarioGenerationProvider({ apiKey: "test-key", fetchImplementation: async () => new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }] }), { status: 200 }) });
    await expect(provider.generate(input)).rejects.toMatchObject({ code: "provider-response-invalid", retryable: false } satisfies Partial<ScenarioProviderError>);
  });
});
