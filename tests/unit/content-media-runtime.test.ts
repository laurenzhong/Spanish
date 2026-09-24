import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createContentMediaRuntime, createYoutubeDownloadArguments } from "@/src/modules/content-acquisition/application/content-media-runtime";

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

  it("defaults live STT to MiniMax when no provider is specified", () => {
    const runtime = createContentMediaRuntime({
      NODE_ENV: "test",
      CONTENT_MEDIA_PROVIDER_MODE: "live",
      MINIMAX_API_KEY: "test-key",
      MINIMAX_TRANSCRIPTION_API_ENDPOINT: "https://api.minimax.cn/v1/speech_to_text",
      MINIMAX_TRANSCRIPTION_MODEL: "asr-1.0",
      CONTENT_MEDIA_TRANSLATION_PROVIDER: "minimax",
    });
    expect(runtime.transcriptionProvider.providerName).toBe("minimax");
  });

  it("uses the bgutil PO Token provider without requiring cookies", () => {
    const args = createYoutubeDownloadArguments({
      url: "https://www.youtube.com/watch?v=authorized",
      outputPath: "/tmp/audio.%(ext)s",
      maxBytes: 200_000_000,
      potProviderUrl: "http://127.0.0.1:4416",
    });
    expect(args).toContain("--extractor-args");
    expect(args).toContain("youtube:player_client=mweb;youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416");
    expect(args).not.toContain("--cookies");
  });
});
