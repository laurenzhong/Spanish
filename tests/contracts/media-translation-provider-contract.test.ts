import { describe, expect, it } from "vitest";

import { FakeMediaTranslationProvider } from "@/src/modules/providers/media-translation";

describe("media translation provider contract", () => {
  it("returns a stable internal translation DTO", async () => {
    const provider = new FakeMediaTranslationProvider();
    const result = await provider.translate({ text: "Hola", sourceLocale: "es-ES", targetLocale: "zh-CN" });
    expect(result).toMatchObject({ provider: "fake", modelVersion: "fake-v1", text: expect.any(String) });
  });
});

