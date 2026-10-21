// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { LanguageReactorAdapter, languageReactorRightsPolicySchema, PodcastRssAdapter } from "@/src/modules/content-acquisition/adapters";
import { suggestLanguageReactorPodcastSeries, suggestRssPodcastSeries } from "@/src/modules/content-acquisition/normalizers/media-series-suggestion";

const now = () => new Date("2026-09-19T00:00:00.000Z");
const rssInput = { sourceStableKey: "podcast.cafe-diario", externalSourceId: "https://podcast.example.test/feed.xml", cursor: null, limit: 20 } as const;
const lrInput = { sourceStableKey: "language-reactor.podcast-mix-es", externalSourceId: "t_pd_mix_es", cursor: null, limit: 20 } as const;

function rssAdapter(fetchImpl: typeof fetch) {
  return new PodcastRssAdapter({
    fetch: fetchImpl,
    now,
    source: {
      feedUrl: rssInput.externalSourceId, programName: "Café de cada día", region: "es-ES", cefr: "A2",
      topics: ["topic.daily-life"], license: "licensed", attribution: "Café de cada día",
      licenseEvidence: "https://podcast.example.test/license", allowedFeedHosts: ["podcast.example.test"],
      allowedEpisodeHosts: ["podcast.example.test"], allowedAudioHosts: ["media.example.test"], allowedTranscriptHosts: [],
      maxEnclosureBytes: 1_000, transcriptSourceKind: "platform_manual", playbackValidityHours: 168,
    },
  });
}

function lrAdapter(fetchImpl: typeof fetch, kind: "video-channel" | "podcast-feed" = "podcast-feed") {
  return new LanguageReactorAdapter({
    fetch: fetchImpl,
    now,
    source: {
      sourceKind: kind, playlistId: lrInput.externalSourceId, displayName: "A mixed directory", region: "es-ES",
      policy: languageReactorRightsPolicySchema.parse({
        provider: "language-reactor", directoryUrl: "https://www.languagereactor.com/c/es/pd/t_pd_mix_es",
        license: "licensed", attribution: "Authorized source", licenseEvidence: "https://www.languagereactor.com/rights",
        cefr: "A2", topics: ["topic.media"], allowedAudioHosts: ["audio.example.test"],
        allowedAudioMimeTypes: ["audio/mpeg"], maxEnclosureBytes: 10_000,
      }),
    },
  });
}

function podcastDocument(info: Record<string, string>) {
  return {
    mediaClass: "AUDIO_FILE", info, audioFileURL: "https://audio.example.test/episode.mp3",
    duration_ms: 120_000, diocoDocId: "it_episode", diocoDocName: "An episode with no series in its title", lang_G: "es",
  };
}

function lrFetch(documents: readonly unknown[], onRequest?: (url: string) => void) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    onRequest?.(url);
    if (url.includes("base_media_getMediaDocs_5")) {
      return new Response(JSON.stringify({ status: "success", data: { docs_metadata: documents } }), { headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://itunes.apple.com/lookup?")) {
      return new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://audio.example.test/")) {
      return new Response(null, { headers: { "content-type": "audio/mpeg", "content-length": "96" } });
    }
    throw new Error("Unexpected request");
  });
}

describe("media series adapter suggestions", () => {
  it("uses RSS structured show metadata and zero season/episode without changing draft hash or request count", async () => {
    const original = await readFile(path.join(process.cwd(), "tests/fixtures/content-acquisition/podcast/feed-with-transcript.xml"), "utf8");
    let feed = original.replace("<itunes:duration>", "<itunes:season>0</itunes:season><itunes:episode>0</itunes:episode><itunes:duration>");
    const fetchImpl = vi.fn<typeof fetch>(async (input) => String(input).endsWith("feed.xml")
      ? new Response(feed, { headers: { "content-type": "application/rss+xml" } })
      : new Response(null, { headers: { "content-type": "audio/mpeg", "content-length": "96" } }));
    const adapter = rssAdapter(fetchImpl);
    const first = (await adapter.discover(rssInput)).items[0];
    expect(first.metadata.mediaSeriesSuggestions).toEqual([expect.objectContaining({
      basis: "podcast_feed", externalSeriesId: rssInput.externalSourceId, title: "Café de cada día",
      status: "unconfirmed", seasonNumber: 0, episodeNumber: 0,
    })]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(first.metadata.podcastDraft).not.toHaveProperty("mediaSeriesSuggestions");

    feed = feed.replace("<itunes:episode>0</itunes:episode>", "<itunes:episode>7</itunes:episode>");
    const second = (await adapter.discover(rssInput)).items[0];
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.metadata.podcastDraft).toEqual(first.metadata.podcastDraft);
    const firstHints = first.metadata.mediaSeriesSuggestions as Array<{ suggestionKey: string }>;
    expect(second.metadata.mediaSeriesSuggestions).toEqual([expect.objectContaining({ suggestionKey: firstHints[0].suggestionKey, episodeNumber: 7 })]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not guess missing RSS titles and keeps contradictory programme or numbering metadata unconfirmed", () => {
    const base = { sourceStableKey: rssInput.sourceStableKey, mediaStableKey: "podcast.episode-1", feedUrl: rssInput.externalSourceId,
      registeredProgramName: "Show", channelTitles: ["Show"], seasons: [], episodes: [] };
    expect(suggestRssPodcastSeries({ ...base, channelTitles: [] })).toBeNull();
    expect(suggestRssPodcastSeries({ ...base, channelTitles: [" "] })).toBeNull();
    expect(suggestRssPodcastSeries(base)).toMatchObject({ seasonNumber: null, episodeNumber: null, status: "unconfirmed" });
    for (const overrides of [
      { channelTitles: ["Show", "Other show"] }, { registeredProgramName: "Different show" },
      { episodes: ["-1"] }, { seasons: ["0", "1"] }, { episodes: ["2147483648"] },
    ]) {
      expect(suggestRssPodcastSeries({ ...base, ...overrides })).toMatchObject({ status: "unconfirmed", warnings: expect.arrayContaining(["metadata_conflict"]) });
    }
  });

  it("uses explicit LR public programme ID and title, keeps the mixed directory as provenance, and adds no fetch", async () => {
    const fetchImpl = lrFetch([podcastDocument({ itunesId: "123456789", feedTitle: "Structured programme" })]);
    const adapter = lrAdapter(fetchImpl);
    const first = (await adapter.discover(lrInput)).items[0];
    expect(first.metadata.mediaSeriesSuggestions).toEqual([expect.objectContaining({
      externalSeriesId: "itunes:123456789", title: "Structured programme", basis: "structured_programme",
      sourceUrl: "https://www.languagereactor.com/c/es/pd/t_pd_mix_es", status: "unconfirmed",
    })]);
    expect(first.metadata.podcastDraft).not.toHaveProperty("mediaSeriesSuggestions");
    expect(fetchImpl).toHaveBeenCalledTimes(3); // Existing directory + HEAD + artwork lookup only.
    const repeated = (await adapter.discover(lrInput)).items[0];
    expect(repeated.metadata.mediaSeriesSuggestions).toEqual(first.metadata.mediaSeriesSuggestions);
    expect(repeated.contentHash).toBe(first.contentHash);
    expect(fetchImpl).toHaveBeenCalledTimes(5); // Existing artwork cache still applies.
  });

  it("requires LR explicit ID/title and never infers a show from a source, document name, or mixed directory", async () => {
    const base = { sourceStableKey: lrInput.sourceStableKey, mediaStableKey: "podcast.language-reactor.it_episode",
      directoryUrl: "https://www.languagereactor.com/c/es/pd/t_pd_mix_es" };
    for (const info of [{ feedTitle: "A title" }, { itunesId: "123456789" }, { itunesId: "0", feedTitle: "A title" },
      { itunesId: "id123", feedTitle: "A title" }, { itunesId: "123", feedTitle: " " }]) {
      expect(suggestLanguageReactorPodcastSeries({ ...base, ...info })).toBeNull();
    }
    const fetchImpl = lrFetch([podcastDocument({ feedTitle: "A title" })]);
    const page = await lrAdapter(fetchImpl).discover(lrInput);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].metadata.mediaSeriesSuggestions).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not turn LR channel metadata into video series or add requests", async () => {
    const fetchImpl = lrFetch([{
      mediaClass: "YOUTUBE", info: { videoId: "Eog6R528OMo", channelId: "UCabcdefghijklmnopqrstuv", channelName: "A channel" },
      duration_ms: 120_000, diocoDocId: "yt_example", diocoDocName: "Some episode", lang_G: "es",
    }]);
    const page = await lrAdapter(fetchImpl, "video-channel").discover(lrInput);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].metadata).not.toHaveProperty("mediaSeriesSuggestions");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects registered source mismatch before requesting either provider", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(rssAdapter(fetchImpl).discover({ ...rssInput, externalSourceId: "https://other.test/feed" })).rejects.toThrow(/identity/u);
    await expect(lrAdapter(fetchImpl).discover({ ...lrInput, externalSourceId: "other_playlist" })).rejects.toThrow(/identity/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["api", "enclosure", "artwork"] as const)("cannot return LR candidates or suggestions after cancellation during %s even if fetch ignores its signal", async (stage) => {
    const controller = new AbortController();
    const fetchImpl = lrFetch([podcastDocument({ itunesId: "123456789", feedTitle: "Show" })], (url) => {
      if ((stage === "api" && url.includes("base_media")) || (stage === "enclosure" && url.includes("audio.example"))
        || (stage === "artwork" && url.includes("itunes.apple"))) controller.abort();
    });
    await expect(lrAdapter(fetchImpl).discover(lrInput, { signal: controller.signal })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes({ api: 1, enclosure: 2, artwork: 3 }[stage]);
  });

  it("cannot return RSS candidates or suggestions after cancellation during enclosure validation", async () => {
    const controller = new AbortController();
    const feed = await readFile(path.join(process.cwd(), "tests/fixtures/content-acquisition/podcast/feed-without-transcript.xml"), "utf8");
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("feed.xml")) return new Response(feed, { headers: { "content-type": "application/rss+xml" } });
      controller.abort();
      return new Response(null, { headers: { "content-type": "audio/mpeg", "content-length": "96" } });
    });
    await expect(rssAdapter(fetchImpl).discover(rssInput, { signal: controller.signal })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
