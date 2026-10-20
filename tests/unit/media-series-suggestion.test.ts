// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { proposeMediaSeriesSuggestion } from "@/src/modules/media/application/propose-media-series-suggestion";
import { mediaSeriesSuggestionInputSchema, mediaSeriesSuggestionSchema } from "@/src/modules/media/schemas/media-series-suggestion";

const input = {
  sourceStableKey: "source.podcast.official", mediaStableKey: "podcast.official.episode-1", kind: "podcast" as const,
  basis: "podcast_feed" as const, externalSeriesId: "https://publisher.example.test/feed.xml", title: "Historias de Madrid",
  sourceUrl: "https://publisher.example.test/feed.xml", seasonNumber: null, episodeNumber: null,
};
afterEach(() => { vi.unstubAllGlobals(); });

describe("unconfirmed media series suggestions", () => {
  it("returns a deterministic bounded proposal with feed ambiguity and honest unknown episode fields", () => {
    const result = proposeMediaSeriesSuggestion(input)!;
    expect(result).toMatchObject({ ...input, status: "unconfirmed", warnings: ["feed_may_be_mixed"] });
    expect(result.suggestionKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(proposeMediaSeriesSuggestion({ ...input })).toEqual(result);
    expect(mediaSeriesSuggestionSchema.safeParse(result).success).toBe(true);
    expect(result).not.toHaveProperty("seriesKey");
    expect(result).not.toHaveProperty("position");
    expect(result).not.toHaveProperty("orderMode");
  });

  it("requires external structural identity and never derives it from a title", () => {
    const { externalSeriesId: omitted, ...titleOnly } = input;
    void omitted;
    expect(proposeMediaSeriesSuggestion(titleOnly)).toBeNull();
    expect(proposeMediaSeriesSuggestion({ ...input, externalSeriesId: "" })).toBeNull();
    const first = proposeMediaSeriesSuggestion(input)!;
    expect(proposeMediaSeriesSuggestion({ ...input, title: "A corrected display title" })?.suggestionKey).toBe(first.suggestionKey);
    expect(proposeMediaSeriesSuggestion({ ...input, episodeNumber: 12 })?.suggestionKey).toBe(first.suggestionKey);
    for (const changed of [
      { ...input, externalSeriesId: "https://publisher.example.test/another-feed.xml" },
      { ...input, sourceStableKey: "source.another" }, { ...input, mediaStableKey: "podcast.another.episode-1" },
    ]) expect(proposeMediaSeriesSuggestion(changed)?.suggestionKey).not.toBe(first.suggestionKey);
  });

  it("keeps season and episode zero while rejecting malformed numbers and identity fields", () => {
    expect(proposeMediaSeriesSuggestion({ ...input, seasonNumber: 0, episodeNumber: 0 })).toMatchObject({ seasonNumber: 0, episodeNumber: 0 });
    for (const invalid of [-1, 1.5, 2_147_483_648, "2", Number.NaN]) {
      expect(proposeMediaSeriesSuggestion({ ...input, seasonNumber: invalid })).toBeNull();
      expect(proposeMediaSeriesSuggestion({ ...input, episodeNumber: invalid })).toBeNull();
    }
    for (const malformed of [
      { ...input, mediaStableKey: "../media" }, { ...input, sourceStableKey: "source key" },
      { ...input, title: "x".repeat(201) }, { ...input, externalSeriesId: "x".repeat(501) },
      { ...input, kind: "video" }, { ...input, basis: "title_similarity" }, { ...input, metadataConflict: "yes" },
    ]) expect(proposeMediaSeriesSuggestion(malformed)).toBeNull();
  });

  it("retains playlist and explicit metadata conflicts as warnings without granting confirmation", () => {
    expect(proposeMediaSeriesSuggestion({ ...input, kind: "video", basis: "playlist", externalSeriesId: "PL-official-123", metadataConflict: true })).toMatchObject({
      status: "unconfirmed", warnings: ["playlist_may_be_curated", "metadata_conflict"],
    });
    expect(proposeMediaSeriesSuggestion({ ...input, basis: "structured_programme", externalSeriesId: "itunes:123456" })).toMatchObject({
      status: "unconfirmed", warnings: [],
    });
    expect(proposeMediaSeriesSuggestion({ ...input, metadataConflict: true })).toMatchObject({ warnings: ["feed_may_be_mixed", "metadata_conflict"] });
  });

  it("accepts only public HTTPS provenance and refuses credentials, signed queries and private hosts", () => {
    for (const sourceUrl of [
      "http://publisher.example.test/feed.xml", "not-a-url", "https://user:secret@example.test/feed.xml", "https://user@example.test/feed.xml",
      "https://publisher.example.test/feed.xml?token=secret", "https://publisher.example.test/feed.xml?%74oken=secret",
      "https://publisher.example.test/feed.xml?X-Amz-Signature=secret", "https://publisher.example.test/feed.xml#access_token=secret",
      "https://localhost/feed.xml", "https://127.0.0.1/feed.xml", "https://192.168.1.2/feed.xml", "https://[::1]/feed.xml", "https://server.internal/feed.xml",
    ]) expect(proposeMediaSeriesSuggestion({ ...input, sourceUrl })).toBeNull();
    expect(proposeMediaSeriesSuggestion({ ...input, sourceUrl: "https://publisher.example.test/feed.xml?programme=123" })).not.toBeNull();
    expect(proposeMediaSeriesSuggestion({ ...input, externalSeriesId: "https://publisher.example.test/feed.xml?token=secret" })).toBeNull();
  });

  it("rejects approval or directory fields and does not call a provider or perform publication", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const extra of [{ seriesKey: "series.guessed" }, { status: "confirmed" }, { position: 1 }, { orderMode: "ordered" }, { reviewer: "approved" }]) {
      expect(proposeMediaSeriesSuggestion({ ...input, ...extra })).toBeNull();
    }
    expect(proposeMediaSeriesSuggestion(input)?.status).toBe("unconfirmed");
    expect(fetch).not.toHaveBeenCalled();
    expect(mediaSeriesSuggestionInputSchema.safeParse({ ...input, status: "unconfirmed" }).success).toBe(false);
  });

  it("fails closed when URL canonicalization would exceed the output bound", () => {
    const sourceUrl = `https://publisher.example.test/${"ñ".repeat(800)}`;
    expect(sourceUrl.length).toBeLessThan(2000);
    expect(() => proposeMediaSeriesSuggestion({ ...input, sourceUrl })).not.toThrow();
    expect(proposeMediaSeriesSuggestion({ ...input, sourceUrl })).toBeNull();
  });
});
