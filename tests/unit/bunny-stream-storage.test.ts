import { afterEach, describe, expect, it, vi } from "vitest";

import { createBunnyStreamMediaAssetStorage } from "@/src/modules/media/storage/bunny-stream-storage";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("Bunny Stream media storage", () => {
  it("creates, uploads, waits for encoding, and returns MP4 fallback URL", async () => {
    process.env.BUNNY_STREAM_LIBRARY_ID = "123456";
    process.env.BUNNY_STREAM_API_KEY = "secret";
    process.env.BUNNY_STREAM_PULL_ZONE_HOSTNAME = "vz-test.b-cdn.net";
    process.env.MEDIA_VIDEO_MAX_HEIGHT = "720";
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "POST") return new Response(JSON.stringify({ guid: "video-guid" }), { status: 200 });
      if (init?.method === "PUT") return new Response(JSON.stringify({ success: true }), { status: 200 });
      return new Response(JSON.stringify({ guid: "video-guid", encodeProgress: 100 }), { status: 200 });
    });

    const storage = createBunnyStreamMediaAssetStorage();
    expect(storage).not.toBeNull();
    const result = await storage!.putVideo("media/youtube.example/1/video.mp4", new Uint8Array([1, 2]), "video/mp4");

    expect(result.url).toBe("https://vz-test.b-cdn.net/video-guid/play_720p.mp4");
    expect(calls.map((call) => call.method)).toEqual(["POST", "PUT", "GET"]);
  });

  it("fails closed when Bunny credentials are incomplete", () => {
    delete process.env.BUNNY_STREAM_API_KEY;
    expect(createBunnyStreamMediaAssetStorage()).toBeNull();
  });

  it("supports Bunny-side origin fetches", async () => {
    process.env.BUNNY_STREAM_LIBRARY_ID = "123456";
    process.env.BUNNY_STREAM_API_KEY = "secret";
    process.env.BUNNY_STREAM_PULL_ZONE_HOSTNAME = "vz-test.b-cdn.net";
    process.env.BUNNY_STREAM_ENCODING_TIMEOUT_MS = "1000";
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/videos/fetch")) return new Response(JSON.stringify({ id: "fetched-guid", success: true }), { status: 200 });
      return new Response(JSON.stringify({ guid: "fetched-guid", status: 4, storageSize: 100, encodeProgress: 100 }), { status: 200 });
    });
    const storage = createBunnyStreamMediaAssetStorage();
    const result = await storage!.putVideoFromUrl!("media/youtube.example/1/video.mp4", "https://origin.example/video.mp4");
    expect(result.url).toBe("https://vz-test.b-cdn.net/fetched-guid/play_720p.mp4");
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET"]);
  });
});
