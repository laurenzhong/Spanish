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
  it("keeps a valid episode after an invalid duration and advances by the provider page length", async () => {
    const episode = {
      mediaClass: "AUDIO_FILE", audioFileURL: "https://audio.example.test/episode.mp3",
      duration_ms: 120_000, diocoDocId: "it_valid", diocoDocName: "Un episodio",
    };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "success", data: {
        docs_metadata: [{ ...episode, diocoDocId: "it_invalid", duration_ms: 0 }, episode],
      } }))
      .mockResolvedValueOnce(new Response(null, { headers: { "content-type": "audio/mpeg", "content-length": "1000" } }));
    const adapter = new LanguageReactorAdapter({
      fetch: fetchImpl,
      source: { sourceKind: "podcast-feed", playlistId: "t_pd_mix_es", displayName: "Language Reactor", region: "es-ES", policy },
    });

    const page = await adapter.discover({
      sourceStableKey: "language-reactor.podcast-mix-es", externalSourceId: "t_pd_mix_es", cursor: '{"offset":180}', limit: 2,
    });
    expect(page.nextCursor).toBe('{"offset":182}');
    expect(page.items.map((item) => item.externalItemId)).toEqual(["it_valid"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports a populated but wholly malformed directory page as a source error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      status: "success", data: { docs_metadata: [{ duration_ms: 0 }] },
    }));
    const adapter = new LanguageReactorAdapter({
      fetch: fetchImpl,
      source: { sourceKind: "podcast-feed", playlistId: "t_pd_mix_es", displayName: "Language Reactor", region: "es-ES", policy },
    });
    await expect(adapter.discover({
      sourceStableKey: "language-reactor.podcast-mix-es", externalSourceId: "t_pd_mix_es", cursor: '{"offset":180}', limit: 2,
    })).rejects.toMatchObject({ reasonCode: "LANGUAGE_REACTOR_DIRECTORY_ITEMS_INVALID", retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

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
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "content-type": "audio/mpeg", "content-length": "1000" } }));
    const adapter = new LanguageReactorAdapter({
      fetch: fetchImpl,
      source: { sourceKind: "podcast-feed", playlistId: "t_pd_mix_es", displayName: "Language Reactor", region: "es-ES", policy: { ...policy, directoryUrl: "https://www.languagereactor.com/c/es/pd/t_pd_mix_es" } },
    });

    const page = await adapter.discover({ sourceStableKey: "language-reactor.podcast-mix-es", externalSourceId: "t_pd_mix_es", cursor: null, limit: 2 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ contentType: "podcast", externalItemId: "it_available" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
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
