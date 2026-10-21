// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaUnavailableError } from "@/src/modules/media/domain";

const mocks = vi.hoisted(() => ({
  verifyRequestUser: vi.fn(),
  getCurrentUser: vi.fn(),
  getMediaStreamSource: vi.fn(),
  getMediaPlayback: vi.fn(),
  createRepository: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock("@/src/shared/auth/server", () => ({
  verifyRequestUser: mocks.verifyRequestUser,
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/src/modules/media/application", () => ({ getMediaStreamSource: mocks.getMediaStreamSource, getMediaPlayback: mocks.getMediaPlayback }));
vi.mock("@/src/modules/media/repositories", () => ({ createDrizzleMediaRepository: mocks.createRepository }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));

import { GET } from "@/app/api/v1/media/[stableKey]/stream/route";

const user = { id: "00000000-0000-4000-8000-000000000001", email: null };
const requestId = "stream_12345678";

function request(stableKey = "podcast.test", init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new NextRequest(`http://localhost/api/v1/media/${encodeURIComponent(stableKey)}/stream`, {
    ...init,
    headers: { "x-request-id": requestId, ...(init.headers ?? {}) },
  });
}

function playback(url = "https://content.libsyn.com/episode.mp3", stableKey = "podcast.test") {
  return {
    media: {
      stableKey,
      version: 1,
      kind: "podcast",
      title: "Episode",
      sourceName: "Test source",
    },
    asset: { kind: "audio", url, expiresAt: null },
  };
}

function videoPlayback(url = "https://sueno-media.b-cdn.net/media/video.test/video.mp4", stableKey = "video.test") {
  return {
    media: { ...playback(url, stableKey).media, stableKey, kind: "video" },
    asset: { kind: "video", url, expiresAt: null },
  };
}

describe("podcast media stream route", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const nativeFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    vi.clearAllMocks();
    mocks.verifyRequestUser.mockResolvedValue(user);
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.createRepository.mockReturnValue({});
    mocks.getDatabase.mockReturnValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = nativeFetch;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("requires authentication before reading playback or proxying a range", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const response = await GET(request(), { params: Promise.resolve({ stableKey: "podcast.test" }) });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_REQUIRED", requestId } });
    expect(mocks.getMediaStreamSource).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not let an invalid bearer fall back to a cookie session", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue(user);
    const response = await GET(request("podcast.test", {
      headers: { authorization: "Bearer invalid-token" },
    }), { params: Promise.resolve({ stableKey: "podcast.test" }) });

    expect(response.status).toBe(401);
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.getMediaStreamSource).not.toHaveBeenCalled();
  });

  it("forwards a bounded Range request and preserves partial-content headers", async () => {
    mocks.getMediaStreamSource.mockResolvedValue(playback());
    const upstream = new Response("test", {
      status: 206,
      headers: {
        "content-type": "audio/mpeg; charset=utf-8",
        "content-length": "4",
        "content-range": "bytes 0-3/100",
      },
    });
    Object.defineProperty(upstream, "url", { value: "https://content.libsyn.com/episode.mp3" });
    const fetcher = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal("fetch", fetcher);

    const response = await GET(request("podcast.test", { headers: { range: "bytes=0-3" } }), {
      params: Promise.resolve({ stableKey: "podcast.test" }),
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe("bytes 0-3/100");
    expect(response.headers.get("content-length")).toBe("4");
    expect(await response.text()).toBe("test");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBeInstanceOf(URL);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { range: "bytes=0-3" }, redirect: "manual" });
    expect(mocks.getMediaPlayback).not.toHaveBeenCalled();
    expect(mocks.getMediaStreamSource).toHaveBeenCalledWith({}, "podcast.test");
  });

  it("does not fetch media bytes when the fresh source read rejects withdrawal or expiry", async () => {
    mocks.getMediaStreamSource.mockRejectedValue(new MediaUnavailableError());
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(request(), { params: Promise.resolve({ stableKey: "podcast.test" }) });
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.getMediaPlayback).not.toHaveBeenCalled();
  });

  it("proxies Bunny-hosted podcast audio instead of exposing the pull-zone URL", async () => {
    mocks.getMediaStreamSource.mockResolvedValue(playback("https://sueno-media.b-cdn.net/media/podcast.test/audio.mp3"));
    const upstream = new Response("bunny-audio", {
      status: 206,
      headers: { "content-type": "audio/mpeg", "content-range": "bytes 0-10/11", "content-length": "11" },
    });
    Object.defineProperty(upstream, "url", { value: "https://sueno-media.b-cdn.net/media/podcast.test/audio.mp3" });
    const fetcher = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal("fetch", fetcher);

    const response = await GET(request("podcast.test", { headers: { range: "bytes=0-10" } }), {
      params: Promise.resolve({ stableKey: "podcast.test" }),
    });

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("bunny-audio");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toEqual(new URL("https://sueno-media.b-cdn.net/media/podcast.test/audio.mp3"));
  });

  it("proxies Bunny-hosted video ranges instead of exposing the pull-zone URL", async () => {
    mocks.getMediaStreamSource.mockResolvedValue(videoPlayback());
    const upstream = new Response("bunny-video", {
      status: 206,
      headers: { "content-type": "video/mp4", "content-range": "bytes 0-10/11", "content-length": "11" },
    });
    Object.defineProperty(upstream, "url", { value: "https://sueno-media.b-cdn.net/media/video.test/video.mp4" });
    const fetcher = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal("fetch", fetcher);

    const response = await GET(request("video.test", { headers: { range: "bytes=0-10" } }), {
      params: Promise.resolve({ stableKey: "video.test" }),
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(await response.text()).toBe("bunny-video");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toEqual(new URL("https://sueno-media.b-cdn.net/media/video.test/video.mp4"));
  });

  it("refreshes an expired Language Reactor URL before proxying audio", async () => {
    const stableKey = "podcast.language-reactor.it_abc123";
    mocks.getMediaStreamSource.mockResolvedValue(playback("https://content.libsyn.com/old.mp3?Expires=1", stableKey));
    const refreshed = new Response(JSON.stringify({ data: { docs_metadata: [{ diocoDocId: "it_abc123", audioFileURL: "https://content.libsyn.com/fresh.mp3" }] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const audio = new Response("fresh", { status: 206, headers: { "content-type": "audio/mpeg", "content-range": "bytes 0-4/5" } });
    Object.defineProperty(audio, "url", { value: "https://content.libsyn.com/fresh.mp3" });
    const fetcher = vi.fn().mockResolvedValueOnce(refreshed).mockResolvedValueOnce(audio);
    vi.stubGlobal("fetch", fetcher);

    const response = await GET(request(stableKey, { headers: { range: "bytes=0-4" } }), {
      params: Promise.resolve({ stableKey }),
    });

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("fresh");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api-cdn.dioco.io/base_media_getMediaDocs_5");
    expect(fetcher.mock.calls[1]?.[0]).toEqual(new URL("https://content.libsyn.com/fresh.mp3"));
  });

  it("falls back to the publisher RSS enclosure when the stored URL is unavailable", async () => {
    const stableKey = "podcast.learncraft.episode148";
    mocks.getMediaStreamSource.mockResolvedValue({
      ...playback("https://content.libsyn.com/stale.mp3", stableKey),
      media: {
        ...playback("https://content.libsyn.com/stale.mp3", stableKey).media,
        title: "148: Right in Spanish: Correcto, derecha, derecho",
        sourceName: "LearnCraft Spanish",
      },
    });
    const feed = new Response(`<rss><channel><item>
      <title>148: Right in Spanish: Correcto, derecha, derecho</title>
      <enclosure url="https://content.libsyn.com/fresh.mp3?dest-id=3943362" />
    </item></channel></rss>`, { status: 200, headers: { "content-type": "application/rss+xml" } });
    const audio = new Response("fresh", { status: 206, headers: { "content-type": "audio/mpeg", "content-range": "bytes 0-4/5" } });
    Object.defineProperty(audio, "url", { value: "https://content.libsyn.com/fresh.mp3?dest-id=3943362" });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("stale", { status: 403 }))
      .mockResolvedValueOnce(feed)
      .mockResolvedValueOnce(audio);
    vi.stubGlobal("fetch", fetcher);

    const response = await GET(request(stableKey, { headers: { range: "bytes=0-4" } }), {
      params: Promise.resolve({ stableKey }),
    });

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("fresh");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1]?.[0]).toEqual(new URL("https://rss.libsyn.com/shows/466488/destinations/3943362.xml"));
    expect(fetcher.mock.calls[2]?.[0]).toEqual(new URL("https://content.libsyn.com/fresh.mp3?dest-id=3943362"));
  });

  it("falls back to the publisher RSS enclosure when the stored host throws a network error", async () => {
    const stableKey = "podcast.charlas.episode1745";
    mocks.getMediaStreamSource.mockResolvedValue({
      ...playback("https://content.blubrry.com/charlashispanas/Episodio_1745-San_Pedro_Claver_mezcla.mp3", stableKey),
      media: {
        ...playback("https://content.blubrry.com/charlashispanas/Episodio_1745-San_Pedro_Claver_mezcla.mp3", stableKey).media,
        title: "1745. San Pedro Claver, el apóstol de los esclavos",
        sourceName: "Charlas Hispanas: Aprende Español | Learn Spanish",
      },
    });
    const feed = new Response(`<rss><channel><item>
      <title>1745. San Pedro Claver, el apóstol de los esclavos</title>
      <enclosure url="https://media.blubrry.com/charlashispanas/content.blubrry.com/charlashispanas/Episodio_1745-San_Pedro_Claver_mezcla.mp3" />
    </item></channel></rss>`, { status: 200, headers: { "content-type": "application/rss+xml" } });
    const audioUrl = new URL("https://charlashispanas.com/wp-content/plugins/simple-podcast-press/responsive_audio_player/downloadaudio.php");
    audioUrl.searchParams.set("file", "https://media.blubrry.com/charlashispanas/content.blubrry.com/charlashispanas/Episodio_1745-San_Pedro_Claver_mezcla.mp3");
    const audio = new Response("fresh", { status: 200, headers: { "content-type": "application/octet-stream", "content-length": "5" } });
    Object.defineProperty(audio, "url", { value: audioUrl.toString() });
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(feed)
      .mockResolvedValueOnce(audio);
    vi.stubGlobal("fetch", fetcher);

    const response = await GET(request(stableKey, { headers: { range: "bytes=0-4" } }), {
      params: Promise.resolve({ stableKey }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("accept-ranges")).toBeNull();
    expect(await response.text()).toBe("fresh");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1]?.[0]).toEqual(new URL("https://charlashispanas.com/feed/podcast/"));
    expect(fetcher.mock.calls[2]?.[0]).toEqual(audioUrl);
  });

  it("fails closed when the upstream follows a redirect to an untrusted host", async () => {
    mocks.getMediaStreamSource.mockResolvedValue(playback());
    const upstream = new Response(null, { status: 302, headers: { location: "https://evil.example/audio.mp3" } });
    const fetcher = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal("fetch", fetcher);

    const response = await GET(request(), { params: Promise.resolve({ stableKey: "podcast.test" }) });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MEDIA_NOT_AVAILABLE", requestId } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
