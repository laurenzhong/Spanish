// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ContentSourceAdapterError,
  createVideoCandidateDraft,
  createYouTubeChannelAdapterFromSource,
  youtubeRightsPolicySchema,
} from "@/src/modules/content-acquisition";
import type { ContentSourceRecord } from "@/src/modules/content-acquisition/repositories";

const source: ContentSourceRecord = {
  id: "00000000-0000-4000-8000-000000000801",
  stableKey: "youtube.espanol-con-calma",
  adapterType: "youtube",
  sourceKind: "video-channel",
  externalSourceId: "UCabcdefghijklmnopqrstuv",
  displayName: "Español con calma",
  language: "es",
  region: "es-ES",
  enabled: true,
  rightsStatus: "verified",
  rightsPolicy: {
    contentMode: "official_embed",
    license: "licensed",
    attribution: "Español con calma en YouTube",
    licenseEvidence: "https://www.youtube.com/t/terms",
    cefr: "A2",
    topics: ["topic.daily-life"],
    allowedRegions: ["ES"],
    maxDurationMs: 1_200_000,
  },
  cursor: null,
  revision: 1,
};

describe("YouTube candidate policy", () => {
  it("requires official embed rights metadata and an explicit learning profile", () => {
    expect(youtubeRightsPolicySchema.parse(source.rightsPolicy)).toMatchObject({
      contentMode: "official_embed",
      cefr: "A2",
      allowedRegions: ["ES"],
    });
    expect(() => youtubeRightsPolicySchema.parse({ contentMode: "download" })).toThrow();
  });

  it("fails closed for disabled, unverified, non-Spanish, or malformed channel sources", () => {
    expect(() => createYouTubeChannelAdapterFromSource(source, fetch, "key")).not.toThrow();
    for (const invalid of [
      { ...source, enabled: false },
      { ...source, rightsStatus: "unknown" as const },
      { ...source, language: "en" },
      { ...source, externalSourceId: "not-a-channel" },
    ]) {
      expect(() => createYouTubeChannelAdapterFromSource(invalid, fetch, "key")).toThrow(ContentSourceAdapterError);
    }
  });

  it("requires the server-side Data API key without storing it in source policy", () => {
    expect(() => createYouTubeChannelAdapterFromSource(source, fetch, "")).toThrow(ContentSourceAdapterError);
    expect(source.rightsPolicy).not.toHaveProperty("apiKey");
  });

  it("keeps the content hash stable across fetch attempts while detecting substantive changes", () => {
    const input = {
      stableKey: "youtube.publicvideo1", platform: "youtube" as const, platformVideoId: "publicVideo1", sourceChannelId: source.externalSourceId,
      canonicalUrl: "https://www.youtube.com/watch?v=publicVideo1", embedUrl: "https://www.youtube-nocookie.com/embed/publicVideo1?enablejsapi=1",
      title: "Cómo pedir un café", summary: "Una conversación breve.", sourceName: source.displayName, language: "es" as const, region: "es-ES", cefr: "A2" as const,
      topics: ["topic.daily-life"], durationMs: 245_000, publicationDate: "2026-09-13T08:00:00.000Z", fetchedAt: "2026-09-13T10:00:00.000Z",
      license: "licensed" as const, attribution: "Español con calma en YouTube", licenseEvidence: "https://www.youtube.com/t/terms", copyrightStatus: "cleared" as const,
      captionStatus: "unavailable" as const, segments: [], changeReason: "First fetch.",
    };
    const first = createVideoCandidateDraft(input);
    const repeated = createVideoCandidateDraft({ ...input, fetchedAt: "2026-09-14T10:00:00.000Z", changeReason: "Repeated fetch." });
    const changed = createVideoCandidateDraft({ ...input, title: "Cómo pedir dos cafés" });
    expect(repeated.contentHash).toBe(first.contentHash);
    expect(changed.contentHash).not.toBe(first.contentHash);
  });
});
