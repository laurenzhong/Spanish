import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBunnyStorageMediaAssetStorage } from "@/src/modules/media/storage/bunny-storage";

beforeEach(() => {
  vi.stubEnv("BUNNY_STORAGE_ZONE_NAME", "test-media");
  vi.stubEnv("BUNNY_STORAGE_PASSWORD", "test-secret");
  vi.stubEnv("BUNNY_STORAGE_PULL_ZONE_HOSTNAME", "test-media.b-cdn.net");
  vi.stubEnv("BUNNY_STORAGE_REGION", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Bunny Storage", () => {
  it("uploads authorized MP3 audio using the same dedicated Storage zone", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await createBunnyStorageMediaAssetStorage()!.putAudio("media/podcast.fixture/1/audio.mp3", new Uint8Array([1, 2]), "audio/mpeg");
    expect(result.url).toBe("https://test-media.b-cdn.net/media/podcast.fixture/1/audio.mp3");
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "PUT", headers: expect.objectContaining({ "content-type": "audio/mpeg" }) }));
    await expect(createBunnyStorageMediaAssetStorage()!.putAudio("media/podcast.fixture/1/audio.mp3", new Uint8Array([1]), "text/html")).rejects.toThrow("bunny-storage-mime-unsupported");
  });
  it("uses the unprefixed endpoint for the default storage region", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await createBunnyStorageMediaAssetStorage()!.putVideo("media/item/1/video.mp4", new Uint8Array([1]), "video/mp4");
    expect(fetcher).toHaveBeenCalledWith("https://storage.bunnycdn.com/test-media/media/item/1/video.mp4", expect.objectContaining({ method: "PUT", redirect: "error", signal: expect.any(AbortSignal) }));
    expect(result.url).toBe("https://test-media.b-cdn.net/media/item/1/video.mp4");
  });
  it("never falls back to a Stream delivery hostname", () => {
    vi.stubEnv("BUNNY_STORAGE_PULL_ZONE_HOSTNAME", "");
    vi.stubEnv("BUNNY_STREAM_PULL_ZONE_HOSTNAME", "stream.b-cdn.net");
    expect(createBunnyStorageMediaAssetStorage()).toBeNull();
  });
  it("rejects unsafe path segments before sending credentials", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(createBunnyStorageMediaAssetStorage()!.putVideo("media/../other.mp4", new Uint8Array([1]), "video/mp4")).rejects.toThrow("bunny-storage-path-invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the selected region and fails on upload errors", async () => {
    vi.stubEnv("BUNNY_STORAGE_REGION", "sg");
    const fetcher = vi.fn().mockResolvedValue(new Response("private details", { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(createBunnyStorageMediaAssetStorage()!.putVideo("media/item/video.mp4", new Uint8Array([1]), "video/mp4")).rejects.toThrow("bunny-storage-upload-401");
    expect(fetcher.mock.calls[0][0]).toBe("https://sg.storage.bunnycdn.com/test-media/media/item/video.mp4");
  });
  it("rejects malformed configuration and empty uploads", async () => {
    vi.stubEnv("BUNNY_STORAGE_PULL_ZONE_HOSTNAME", "https://user:password@host/path");
    expect(createBunnyStorageMediaAssetStorage()).toBeNull();
    vi.stubEnv("BUNNY_STORAGE_PULL_ZONE_HOSTNAME", "test.b-cdn.net");
    await expect(createBunnyStorageMediaAssetStorage()!.putVideo("media/item/video.mp4", new Uint8Array(), "video/mp4")).rejects.toThrow("bunny-storage-body-empty");
  });
});
