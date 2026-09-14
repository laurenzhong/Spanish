// @vitest-environment node

import { describe, expect, it } from "vitest";

import { FakeMediaTranslationProvider } from "@/src/modules/media-processing";

describe("media translation provider contract", () => {
  it("returns a trimmed normalized translation", async () => {
    await expect(new FakeMediaTranslationProvider(() => "  你好。  ").translate({ index: 0, sourceText: "Hola." })).resolves.toMatchObject({
      text: "你好。", modelVersion: "fake-media-translation-v1", estimatedCostMicros: 0,
    });
  });

  it("rejects empty output and cancellation", async () => {
    await expect(new FakeMediaTranslationProvider(() => "   ").translate({ index: 0, sourceText: "Hola." })).rejects.toMatchObject({ code: "MEDIA_TRANSCRIPTION_FAILED" });
    const controller = new AbortController();
    controller.abort();
    await expect(new FakeMediaTranslationProvider(() => "你好").translate({ index: 0, sourceText: "Hola." }, { signal: controller.signal })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_CANCELLED" });
  });
});
