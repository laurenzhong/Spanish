import { describe, expect, it } from "vitest";

import {
  generatedStoryEstimatedMinutes,
  generatedStoryRequestSchema,
  normalizeGeneratedStoryPayload,
  normalizeGeneratedStoryRequest,
} from "@/src/modules/reading/domain/generated-story";

describe("generated story domain", () => {
  it("normalizes request keywords and strips control/html text", () => {
    const request = normalizeGeneratedStoryRequest({
      prompt: "  <b>Una tarde</b>\n en Madrid  ",
      cefr: "B1",
      length: "medium",
      format: "story",
      keywords: [" amistad ", "", "café"],
    });
    expect(request.prompt).toBe("Una tarde en Madrid");
    expect(request.keywords).toEqual(["amistad", "café"]);
  });

  it("rejects invalid request bounds", () => {
    expect(() => generatedStoryRequestSchema.parse({ prompt: "", cefr: "B1", length: "medium", format: "story", keywords: [] })).toThrow();
    expect(() => generatedStoryRequestSchema.parse({ prompt: "ok", cefr: "C1", length: "medium", format: "story", keywords: [] })).toThrow();
    expect(() => generatedStoryRequestSchema.parse({ prompt: "ok", cefr: "B1", length: "medium", format: "story", keywords: Array.from({ length: 9 }, () => "x") })).toThrow();
  });

  it("cleans payload and enforces non-empty and total length", () => {
    const payload = normalizeGeneratedStoryPayload({
      title: " <b>Una historia</b> ",
      summary: " Un resumen. ",
      segments: [" Primero. ", "<script>alert(1)</script>Segundo."],
      cefr: "B1",
      topics: [" amistad ", ""],
      register: "neutral",
    });
    expect(payload.title).toBe("Una historia");
    expect(payload.segments).toEqual(["Primero.", "Segundo."]);
    expect(payload.topics).toEqual(["amistad"]);
    expect(() => normalizeGeneratedStoryPayload({
      title: "x", summary: "y", segments: ["x".repeat(8_001)], cefr: "B1", topics: [], register: "neutral",
    })).toThrow("GENERATED_STORY_TOO_LONG");
  });

  it("estimates reading minutes from word count", () => {
    expect(generatedStoryEstimatedMinutes(["una dos tres"])).toBe(1);
    expect(generatedStoryEstimatedMinutes([Array.from({ length: 181 }, () => "palabra").join(" ")])).toBe(2);
  });
});
