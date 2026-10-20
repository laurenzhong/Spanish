import { describe, expect, it, vi } from "vitest";

import { LanguageReactorAdapter, languageReactorRightsPolicySchema } from "@/src/modules/content-acquisition/adapters";

const policy = languageReactorRightsPolicySchema.parse({
  provider: "language-reactor",
  directoryUrl: "https://www.languagereactor.com/c/es/yt/t_yt_mix_es",
  license: "licensed",
  attribution: "Owner-authorized source.",
  licenseEvidence: "https://www.languagereactor.com/c/es/yt/t_yt_mix_es",
  authorization: "Owner authorization record.",
  cefr: "A2",
  topics: ["topic.media"],
  allowedAudioHosts: ["audio.example.test"],
  allowedAudioMimeTypes: ["audio/mpeg"],
  maxEnclosureBytes: 10_000_000,
  temporaryMediaProcessing: "yt-dlp",
  maxTemporaryMediaBytes: 25_000_000,
});

describe("Language Reactor adapter", () => {
  it("normalizes authorized Spanish YouTube documents into official embed candidates", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: "success",
      data: { docs_metadata: [{
        mediaClass: "YOUTUBE",
        info: { videoId: "Eog6R528OMo", channelId: "UCabcdefghijklmnopqrstuv", channelName: "Canal Espanol" },
        duration_ms: 120_000,
        diocoDocId: "yt_Eog6R528OMo",
        diocoDocName: "Una conversacion breve",
        description: "Practica cotidiana.",
        lang_G: "es",
        publishDate: { timestamp_unixms: 1789300000000 },
      }] },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const adapter = new LanguageReactorAdapter({
      fetch: fetchImpl,
      source: { sourceKind: "video-channel", playlistId: "t_yt_mix_es", displayName: "Language Reactor", region: "es-ES", policy },
      now: () => new Date("2026-09-19T00:00:00.000Z"),
    });

    const page = await adapter.discover({ sourceStableKey: "language-reactor.youtube-mix-es", externalSourceId: "t_yt_mix_es", cursor: null, limit: 1 });

    expect(page.items[0]).toMatchObject({ contentType: "video", externalItemId: "Eog6R528OMo" });
    expect(page.items[0]?.metadata.videoDraft).toMatchObject({
      embedUrl: "https://www.youtube-nocookie.com/embed/Eog6R528OMo?enablejsapi=1",
      captionStatus: "unavailable",
      copyrightStatus: "cleared",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://api-cdn.dioco.io/base_media_getMediaDocs_5");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      filters: { mediaTab: "TAB_YOUTUBE" },
      freq95: { min: 0, max: 100_000 },
      pinnedDiocoPlaylistIds: [],
      forceIncludeDiocoDocId: null,
    });
  });

  it("skips one unavailable enclosure without aborting the directory page", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "success",
        data: { docs_metadata: [{
          mediaClass: "AUDIO_FILE",
          info: { feedTitle: "Podcast" },
          audioFileURL: "https://audio.example.test/episode.mp3",
          duration_ms: 120_000,
          diocoDocId: "it_retryable",
          diocoDocName: "Un episodio",
          description: "Practica cotidiana.",
          lang_G: "es",
        }, {
          mediaClass: "AUDIO_FILE",
          info: { feedTitle: "Podcast" },
          audioFileURL: "https://audio.example.test/episode-2.mp3",
          duration_ms: 120_000,
          diocoDocId: "it_available",
          diocoDocName: "Otro episodio",
          description: "Practica cotidiana.",
          lang_G: "es",
        }] },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockRejectedValueOnce(new TypeError("socket closed"))
      .mockRejectedValueOnce(new TypeError("socket closed"))
      .mockRejectedValueOnce(new TypeError("socket closed"))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "content-type": "audio/mpeg", "content-length": "1000" } }));
    const adapter = new LanguageReactorAdapter({
      fetch: fetchImpl,
      source: { sourceKind: "podcast-feed", playlistId: "t_pd_mix_es", displayName: "Language Reactor", region: "es-ES", policy: { ...policy, directoryUrl: "https://www.languagereactor.com/c/es/pd/t_pd_mix_es" } },
    });

    const page = await adapter.discover({ sourceStableKey: "language-reactor.podcast-mix-es", externalSourceId: "t_pd_mix_es", cursor: null, limit: 2 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ contentType: "podcast", externalItemId: "it_available" });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("follows the authorized multi-hop CDN redirect chain for podcast audio", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "success",
        data: { docs_metadata: [{
          mediaClass: "AUDIO_FILE",
          info: { feedTitle: "Podcast" },
          audioFileURL: "https://audio.example.test/episode.mp3",
          duration_ms: 120_000,
          diocoDocId: "it_multihop",
          diocoDocName: "Un episodio con CDN",
          description: "Practica cotidiana.",
          lang_G: "es",
        }] },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://audio.example.test/hop-1.mp3" } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://audio.example.test/hop-2.mp3" } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://audio.example.test/hop-3.mp3" } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://audio.example.test/hop-4.mp3" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "content-type": "audio/mpeg", "content-length": "1000" } }));
    const adapter = new LanguageReactorAdapter({
      fetch: fetchImpl,
      source: { sourceKind: "podcast-feed", playlistId: "t_pd_mix_es", displayName: "Language Reactor", region: "es-ES", policy: { ...policy, directoryUrl: "https://www.languagereactor.com/c/es/pd/t_pd_mix_es" } },
    });

    const page = await adapter.discover({ sourceStableKey: "language-reactor.podcast-mix-es", externalSourceId: "t_pd_mix_es", cursor: null, limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ contentType: "podcast", externalItemId: "it_multihop" });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});
