import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createContentMediaRuntime } from "@/src/modules/content-acquisition/application/content-media-runtime";

describe("content media runtime", () => {
  it("allows podcast source files up to 50 MB while keeping provider processing policy explicit", () => {
    const runtime = createContentMediaRuntime({ NODE_ENV: "test", CONTENT_MEDIA_PROVIDER_MODE: "fake" });
    expect(runtime.policy.maxAssetBytes).toBe(50 * 1024 * 1024);
  });

  it("selects MiniMax ASR when explicitly configured", () => {
    const runtime = createContentMediaRuntime({
      NODE_ENV: "test",
      CONTENT_MEDIA_PROVIDER_MODE: "live",
      CONTENT_MEDIA_STT_PROVIDER: "minimax",
      MINIMAX_API_KEY: "test-key",
      MINIMAX_TRANSCRIPTION_API_ENDPOINT: "https://api.minimax.cn/v1/speech_to_text",
      MINIMAX_TRANSCRIPTION_MODEL: "asr-1.0",
      CONTENT_MEDIA_TRANSLATION_PROVIDER: "minimax",
    });
    expect(runtime.transcriptionProvider.providerName).toBe("minimax");
    expect(runtime.transcriptionProvider.modelVersion).toBe("asr-1.0");
  });
});
