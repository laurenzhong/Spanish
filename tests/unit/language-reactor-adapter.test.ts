import { describe, expect, it, vi } from "vitest";

import {
  LanguageReactorAdapter,
  languageReactorRightsPolicySchema,
} from "@/src/modules/content-acquisition/adapters";

const policy = languageReactorRightsPolicySchema.parse({
  provider: "language-reactor",
  directoryUrl: "https://www.languagereactor.com/c/es/pd/t_pd_mix_es",
  license: "licensed",
  attribution: "No attribution required by authorization.",
  licenseEvidence: "https://www.languagereactor.com/c/es/pd/t_pd_mix_es",
  authorization: "Owner-provided authorization statement.",
  cefr: "A2",
  topics: ["topic.media"],
  allowedAudioHosts: ["audio.example.test"],
  allowedAudioMimeTypes: ["audio/mpeg"],
  minDurationMs: 15_000,
  maxDurationMs: 3_600_000,
  maxApiBytes: 100_000,
  maxEnclosureBytes: 10_000_000,
  playbackValidityHours: 168,
});

function source(sourceKind: "video-channel" | "podcast-feed") {
  return {
    sourceKind,
    playlistId: sourceKind === "video-channel" ? "t_yt_mix_es" : "t_pd_mix_es",
    directoryUrl: sourceKind === "video-channel"
      ? "https://www.languagereactor.com/c/es/yt/t_yt_mix_es"
      : "https://www.languagereactor.com/c/es/pd/t_pd_mix_es",
    displayName: "Language Reactor",
    region: "es-ES",
    policy,
  };
}

function response(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Response(JSON.stringify(body), { status: 200, headers });
}

describe("Language Reactor adapter", () => {
  it("normalizes curated YouTube documents into official embed candidates", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({
      status: "success",
      data: {
        docs_metadata: [{
          mediaClass: "YOUTUBE",
          source: "YOUTUBE",
          info: { videoId: "Eog6R528OMo", channelId: "UCabcdefghijklmnopqrstuv", channelName: "Canal Español" },
          duration_ms: 120_000,
          diocoDocId: "yt_Eog6R528OMo",
          diocoDocName: "Una conversación breve",
          description: "Práctica cotidiana.",
          lang_G: "es",
          publishDate: { type: "UNIXMS", timestamp_unixms: 1789300000000 },
        }],
      },
    }));
    const adapter = new LanguageReactorAdapter({ fetch: fetchImpl, source: source("video-channel"), now: () => new Date("2026-09-15T00:00:00.000Z") });

    const page = await adapter.discover({ sourceStableKey: "lr-video", externalSourceId: "t_yt_mix_es", cursor: null, limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ contentType: "video", externalItemId: "Eog6R528OMo" });
    expect(page.items[0]?.metadata.videoDraft).toMatchObject({
      platformVideoId: "Eog6R528OMo",
      embedUrl: "https://www.youtube-nocookie.com/embed/Eog6R528OMo?enablejsapi=1",
      captionStatus: "unavailable",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://api-cdn.dioco.io/base_media_getMediaDocs_5");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("accepts YouTube IDs beginning with a separator", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({
      status: "success",
      data: {
        docs_metadata: [{
          mediaClass: "YOUTUBE",
          source: "YOUTUBE",
          info: { videoId: "-Z-6DmE7Ucs", channelId: "UCrreHSUa5rnuCVDeO8dX4eA" },
          duration_ms: 120_000,
          diocoDocId: "yt_-Z-6DmE7Ucs",
          diocoDocName: "Una charla breve",
          description: "Práctica cotidiana.",
          lang_G: "es",
        }],
      },
    }));
    const adapter = new LanguageReactorAdapter({ fetch: fetchImpl, source: source("video-channel") });

    const page = await adapter.discover({ sourceStableKey: "lr-video", externalSourceId: "t_yt_mix_es", cursor: null, limit: 1 });

    expect(page.items[0]?.metadata.videoDraft).toMatchObject({
      platformVideoId: "-Z-6DmE7Ucs",
      stableKey: expect.stringMatching(/^youtube\.language-reactor\.[a-f0-9]{24}$/u),
    });
  });

  it("probes podcast enclosures with HEAD and preserves cursor pagination", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        status: "success",
        data: {
          docs_metadata: [{
            mediaClass: "AUDIO_FILE",
            source: "PODCAST",
            info: { feedTitle: "Podcast autorizado" },
            audioFileURL: "https://audio.example.test/episode.mp3",
            duration_ms: 90_000,
            diocoDocId: "it_episode_1",
            diocoDocName: "Una charla breve",
            description: "Escucha en español.",
            lang_G: "es",
            publishDate: { type: "UNIXMS", timestamp_unixms: 1789300000000 },
          }],
        },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "content-type": "audio/mpeg", "content-length": "240000" } }));
    const adapter = new LanguageReactorAdapter({ fetch: fetchImpl, source: source("podcast-feed"), now: () => new Date("2026-09-15T00:00:00.000Z") });

    const page = await adapter.discover({ sourceStableKey: "lr-podcast", externalSourceId: "t_pd_mix_es", cursor: null, limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ contentType: "podcast", externalItemId: "it_episode_1" });
    expect(page.items[0]?.metadata.podcastDraft).toMatchObject({
      enclosureUrl: "https://audio.example.test/episode.mp3",
      enclosureByteSize: 240_000,
      transcriptStatus: "unavailable",
    });
    expect(page.nextCursor).toBe(JSON.stringify({ offset: 1 }));
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: "HEAD" });
  });

  it("rejects malformed cursors without making a network request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new LanguageReactorAdapter({ fetch: fetchImpl, source: source("video-channel") });

    await expect(adapter.discover({ sourceStableKey: "lr-video", externalSourceId: "t_yt_mix_es", cursor: "not-json", limit: 10 })).rejects.toThrow("cursor is invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
