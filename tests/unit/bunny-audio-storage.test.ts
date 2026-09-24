import { afterEach, describe, expect, it, vi } from "vitest";

import { createBunnyStorageMediaAssetStorage } from "@/src/modules/media/storage/bunny-storage";

describe("Bunny audio storage", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uploads MPEG audio and returns the pull-zone URL", async () => {
    vi.stubEnv("BUNNY_STORAGE_ZONE_NAME", "sueno-media");
    vi.stubEnv("BUNNY_STORAGE_PASSWORD", "test-password");
    vi.stubEnv("BUNNY_STORAGE_PULL_ZONE_HOSTNAME", "sueno-media.b-cdn.net");
    vi.stubEnv("BUNNY_STORAGE_REGION", "sg");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    globalThis.fetch = fetchMock;
    const storage = createBunnyStorageMediaAssetStorage();
    expect(storage).not.toBeNull();

    await expect(storage!.putAudio("media/test/1/audio.mp3", new Uint8Array([1, 2, 3]), "audio/mpeg"))
      .resolves.toEqual({ url: "https://sueno-media.b-cdn.net/media/test/1/audio.mp3" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sg.storage.bunnycdn.com/sueno-media/media/test/1/audio.mp3",
      expect.objectContaining({ method: "PUT", headers: expect.objectContaining({ "content-type": "audio/mpeg" }) }),
    );
  });
});
