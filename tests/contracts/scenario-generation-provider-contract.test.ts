import { describe, expect, it } from "vitest";

import { FakeScenarioGenerationProvider, scenarioGenerationResultSchema } from "@/src/modules/providers/scenario-generation";

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
});
