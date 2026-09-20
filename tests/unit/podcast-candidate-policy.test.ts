// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ContentSourceAdapterError,
  createPodcastCandidateDraft,
  createPodcastRssAdapterFromSource,
  podcastCandidateDraftSchema,
  podcastEpisodeStableKey,
  podcastRightsPolicySchema,
} from "@/src/modules/content-acquisition";
import type { ContentSourceRecord } from "@/src/modules/content-acquisition/repositories";

const source: ContentSourceRecord = {
  id: "00000000-0000-4000-8000-000000000901",
  stableKey: "podcast.cafe-diario",
  adapterType: "podcast-rss",
  sourceKind: "podcast-feed",
  externalSourceId: "https://podcast.example.test/feed.xml",
  displayName: "Café de cada día",
  language: "es",
  region: "es-ES",
  enabled: true,
  rightsStatus: "verified",
  rightsPolicy: {
    contentMode: "enclosure_playback",
    license: "licensed",
    attribution: "Café de cada día",
    licenseEvidence: "https://podcast.example.test/license",
    allowedFeedHosts: ["podcast.example.test"],
    allowedEpisodeHosts: ["podcast.example.test"],
    allowedAudioHosts: ["media.example.test"],
    allowedTranscriptHosts: ["transcripts.example.test"],
    transcriptSourceKind: "platform_manual",
    cefr: "A2",
    topics: ["topic.daily-life"],
    maxEnclosureBytes: 20_000_000,
  },
  cursor: null,
  revision: 1,
};

describe("podcast candidate policy", () => {
  it("requires explicit enclosure playback rights, hosts, and learning metadata", () => {
    expect(podcastRightsPolicySchema.parse(source.rightsPolicy)).toMatchObject({
      contentMode: "enclosure_playback",
      cefr: "A2",
      allowedAudioHosts: ["media.example.test"],
    });
    expect(() => podcastRightsPolicySchema.parse({ contentMode: "download" })).toThrow();
  });

  it("fails closed for disabled, unverified, non-Spanish, non-HTTPS, or wrong-kind sources", () => {
    expect(() => createPodcastRssAdapterFromSource(source, fetch)).not.toThrow();
    for (const invalid of [
      { ...source, enabled: false },
      { ...source, rightsStatus: "unknown" as const },
      { ...source, language: "en" },
      { ...source, externalSourceId: "http://podcast.example.test/feed.xml" },
      { ...source, sourceKind: "article-feed" as const },
    ]) {
      expect(() => createPodcastRssAdapterFromSource(invalid, fetch)).toThrow(ContentSourceAdapterError);
    }
  });

  it("keeps hashes stable across fetch/expiry changes and detects episode changes", () => {
    const input = {
      stableKey: "podcast.episode42", feedUrl: source.externalSourceId, episodeGuid: "episode-42",
      canonicalUrl: "https://podcast.example.test/episodes/42", enclosureUrl: "https://media.example.test/audio/42.mp3",
      enclosureMimeType: "audio/mpeg" as const, enclosureByteSize: 128, playbackExpiresAt: "2026-09-21T10:00:00.000Z",
      title: "Una mañana en el mercado", summary: "Una charla breve.", sourceName: source.displayName,
      language: "es" as const, region: "es-ES", cefr: "A2" as const, topics: ["topic.daily-life"], durationMs: 360_000,
      publicationDate: "2026-09-13T08:00:00.000Z", fetchedAt: "2026-09-14T10:00:00.000Z",
      license: "licensed" as const, attribution: "Café de cada día", licenseEvidence: "https://podcast.example.test/license",
      copyrightStatus: "cleared" as const, transcriptStatus: "unavailable" as const, transcriptUrl: null, segments: [], changeReason: "First fetch.",
    };
    const first = createPodcastCandidateDraft(input);
    const repeated = createPodcastCandidateDraft({ ...input, fetchedAt: "2026-09-15T10:00:00.000Z", playbackExpiresAt: "2026-09-22T10:00:00.000Z", changeReason: "Repeated fetch." });
    const changed = createPodcastCandidateDraft({ ...input, enclosureByteSize: 256 });
    expect(repeated.contentHash).toBe(first.contentHash);
    expect(changed.contentHash).not.toBe(first.contentHash);
    expect(podcastEpisodeStableKey(source.stableKey, first.episodeGuid)).toBe(
      podcastEpisodeStableKey(source.stableKey, changed.episodeGuid),
    );
  });

  it("normalizes the legacy JSON date shape and supports permanent authorized playback", () => {
    const parsed = podcastCandidateDraftSchema.parse({
      stableKey: "podcast.language-reactor.legacy", feedUrl: "https://podcast.example.test/feed.xml", episodeGuid: "legacy-episode",
      canonicalUrl: "https://podcast.example.test/episodes/legacy", enclosureUrl: "https://media.example.test/audio/legacy.mp3",
      enclosureUrlHash: "0".repeat(64), enclosureMimeType: "audio/mpeg", enclosureByteSize: 128,
      playbackExpiresAt: { $date: "2026-09-21T10:00:00.000Z" },
      title: "Un episodio antiguo", summary: "Resumen.", sourceName: source.displayName, language: "es", region: "es-ES", cefr: "A2",
      topics: ["topic.daily-life"], durationMs: 60_000, publicationDate: "2026-09-13T08:00:00.000Z", fetchedAt: "2026-09-13T10:00:00.000Z",
      license: "licensed", attribution: "Café de cada día", licenseEvidence: "https://podcast.example.test/license", copyrightStatus: "cleared",
      artwork: null, transcriptStatus: "unavailable", transcriptUrl: null, segments: [], contentHash: "0".repeat(64), changeReason: "Legacy fixture.",
    });
    expect(parsed.playbackExpiresAt).toBe("2026-09-21T10:00:00.000Z");
    expect(podcastCandidateDraftSchema.parse({ ...parsed, playbackExpiresAt: null }).playbackExpiresAt).toBeNull();
  });
});
