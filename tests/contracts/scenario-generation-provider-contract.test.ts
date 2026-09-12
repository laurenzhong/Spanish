import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FakeScenarioGenerationProvider, scenarioGenerationResultSchema } from "@/src/modules/providers/scenario-generation";
import { OpenAIScenarioGenerationProvider } from "@/src/modules/providers/scenario-generation/server";

describe("scenario generation provider contract", () => {
  it("returns a complete private-practice payload and keeps source text out of provider metadata", async () => {
    const provider = new FakeScenarioGenerationProvider();
    const result = await provider.generate({
      requestId: "request-1",
      generationId: "generation-1",
      locale: "es-ES",
      cefr: "A2",
      topic: "在咖啡馆礼貌提出请求",
      sourceExpressions: ["Quisiera un café, por favor."],
    });
    expect(scenarioGenerationResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      provider: "deterministic-scenario-generation",
      openingLine: expect.any(String),
      expressions: [{ text: "Quisiera un café, por favor." }],
    });
  });

  it("converts an OpenAI Responses payload into the same internal result", async () => {
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer test-key" });
      expect(String(init?.body)).toContain("Quisiera un café");
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        title: "En la cafetería",
        setting: "Una cafetería ficticia",
        openingLine: "Buenas, ¿qué desea?",
        communicationGoals: ["礼貌点一杯咖啡"],
        conditionChanges: [],
        expressions: [{ text: "Quisiera un café, por favor.", translation: "我想要一杯咖啡。", communicativeIntent: "礼貌请求", variants: [] }],
        temporaryCharacter: { displayName: "Elena", role: "camarera", locale: "es-ES" },
      }) }), { status: 200, headers: { "x-request-id": "openai-request-1" } });
    });
    const provider = new OpenAIScenarioGenerationProvider({ apiKey: "test-key", fetchImplementation, clock: () => 20 });
    const result = await provider.generate({ requestId: "request-2", generationId: "generation-2", locale: "es-ES", cefr: "A2", topic: "咖啡馆", sourceExpressions: ["Quisiera un café, por favor."] });
    expect(scenarioGenerationResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ provider: "openai", providerRequestId: "openai-request-1" });
  });
});
