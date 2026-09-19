import { describe, expect, it, vi } from "vitest";

import { LanguageReactorAdapter, languageReactorRightsPolicySchema } from "@/src/modules/content-acquisition/adapters";

const policy = languageReactorRightsPolicySchema.parse({
  provider: "language-reactor",
  directoryUrl: "https://www.languagereactor.com/c/es/yt/t_yt_mix_es",
  license: "licensed",
  attribution: "Owner-authorized source.",
  licenseEvidence: "https://www.languagereactor.com/c/es/yt/t_yt_mix_es",
  cefr: "A2",
  topics: ["topic.media"],
  allowedAudioHosts: ["audio.example.test"],
  allowedAudioMimeTypes: ["audio/mpeg"],
  maxEnclosureBytes: 10_000_000,
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
  });
});
