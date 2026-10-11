import { afterEach, describe, expect, it, vi } from "vitest";

import type { MediaArtwork } from "@/src/modules/media/domain";
import { createMediaArtworkStorage } from "@/src/modules/media/storage/artwork-storage";

const artwork: MediaArtwork = {
  url: "https://cdn.example.test/cover.jpg",
  alt: "Portada",
  source: "podcast-feed",
  width: 1400,
  height: 1400,
  expiresAt: "2026-10-20T00:00:00.000Z",
};

function recordingStorage() {
  const puts: Array<{ path: string; byteLength: number; contentType: string }> = [];
  return {
    puts,
    storage: {
      putAudio: vi.fn(),
      putVideo: vi.fn(),
      putArtwork: vi.fn(async (path: string, body: Uint8Array, contentType: string) => {
        puts.push({ path, byteLength: body.byteLength, contentType });
        return { url: `https://sueno-media.b-cdn.net/${path}` };
      }),
      remove: vi.fn(),
    },
  };
}

function imageResponse(bytes = new Uint8Array([1, 2, 3]), contentType = "image/jpeg") {
  return new Response(bytes, { status: 200, headers: { "content-type": contentType } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("media artwork storage", () => {
  it("copies the artwork into our storage under a content-addressed path", async () => {
    const { storage, puts } = recordingStorage();
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse()));

    const snapshot = await createMediaArtworkStorage(storage).snapshot({ stableKey: "podcast.example.episode1", revision: 5, artwork });

    expect(puts).toHaveLength(1);
    expect(puts[0]?.contentType).toBe("image/jpeg");
    expect(puts[0]?.path).toMatch(/^media\/artwork\/podcast\.example\.episode1\/v5-[a-f0-9]{32}\.jpg$/u);
    expect(snapshot).toEqual({
      url: `https://sueno-media.b-cdn.net/${puts[0]?.path}`,
      alt: artwork.alt,
      source: artwork.source,
      width: artwork.width,
      height: artwork.height,
      expiresAt: null,
    });
  });

  it("is idempotent for the same bytes at the same revision", async () => {
    const { storage, puts } = recordingStorage();
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse()));
    const target = createMediaArtworkStorage(storage);

    await target.snapshot({ stableKey: "podcast.example.episode1", revision: 5, artwork });
    await target.snapshot({ stableKey: "podcast.example.episode1", revision: 5, artwork });

    expect(puts[0]?.path).toBe(puts[1]?.path);
  });

  it("refuses a source that is not https before making a request", async () => {
    const { storage } = recordingStorage();
    const fetcher = vi.fn(async () => imageResponse());
    vi.stubGlobal("fetch", fetcher);

    await expect(createMediaArtworkStorage(storage).snapshot({
      stableKey: "podcast.example.episode1",
      revision: 1,
      artwork: { ...artwork, url: "http://cdn.example.test/cover.jpg" },
    })).rejects.toThrow("artwork-url-unsafe");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("re-validates every redirect hop", async () => {
    const { storage } = recordingStorage();
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    }));
    vi.stubGlobal("fetch", fetcher);

    await expect(createMediaArtworkStorage(storage).snapshot({ stableKey: "podcast.example.episode1", revision: 1, artwork }))
      .rejects.toThrow("artwork-url-unsafe");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses a payload that is not an image", async () => {
    const { storage, puts } = recordingStorage();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } })));

    await expect(createMediaArtworkStorage(storage).snapshot({ stableKey: "podcast.example.episode1", revision: 1, artwork }))
      .rejects.toThrow("artwork-content-type-unsupported");
    expect(puts).toHaveLength(0);
  });

  it("refuses an oversized payload, declared or actual", async () => {
    const { storage, puts } = recordingStorage();
    const target = createMediaArtworkStorage(storage);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": String(6 * 1024 * 1024) },
    })));
    await expect(target.snapshot({ stableKey: "podcast.example.episode1", revision: 1, artwork })).rejects.toThrow("artwork-too-large");

    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(new Uint8Array(6 * 1024 * 1024))));
    await expect(target.snapshot({ stableKey: "podcast.example.episode1", revision: 1, artwork })).rejects.toThrow("artwork-too-large");
    expect(puts).toHaveLength(0);
  });

  it("refuses a failed download and an empty body", async () => {
    const { storage } = recordingStorage();
    const target = createMediaArtworkStorage(storage);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    await expect(target.snapshot({ stableKey: "podcast.example.episode1", revision: 1, artwork })).rejects.toThrow("artwork-download-403");

    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(new Uint8Array())));
    await expect(target.snapshot({ stableKey: "podcast.example.episode1", revision: 1, artwork })).rejects.toThrow("artwork-empty");
  });
});
