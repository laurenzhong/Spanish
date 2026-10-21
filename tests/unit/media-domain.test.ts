// @vitest-environment node

import { describe, expect, it } from "vitest";

import { matchesMediaTopic, MediaUnavailableError, parseMediaDocumentId, projectMediaCard, projectMediaPlayback } from "@/src/modules/media";

const raw = {
  stableKey: "media.fixture.cafe", version: 2, kind: "video" as const,
  title: "Conversaciones en una cafetería", summary: "Una conversación breve y natural.",
  sourceName: "Canal de ejemplo", language: "es", region: "es-ES", cefr: "A2" as const,
  topics: ["topic.daily-life"], durationMs: 185_000,
  publishedAt: new Date("2026-09-12T08:00:00.000Z"), curatedAt: new Date("2026-09-13T08:00:00.000Z"),
  contentHash: "a".repeat(64), status: "published" as const, copyrightStatus: "cleared" as const, playable: true,
};

describe("media domain", () => {
  it("maps source topic aliases into stable learning categories", () => {
    expect(matchesMediaTopic(["topic.daily-life"], "daily-life")).toBe(true);
    expect(matchesMediaTopic([" topic.NEWS "], "current-events")).toBe(true);
    expect(matchesMediaTopic(["topic.city"], "travel-city")).toBe(true);
    expect(matchesMediaTopic(["topic.news"], "relationships")).toBe(false);
  });

  it("projects only playable, rights-cleared published versions", () => {
    expect(projectMediaCard(raw)).toMatchObject({ id: "media.fixture.cafe@2", kind: "video", durationMs: 185_000 });
    expect(projectMediaCard({ ...raw, playable: false })).toBeNull();
    expect(projectMediaCard({ ...raw, status: "archived" })).toBeNull();
    expect(projectMediaCard({ ...raw, copyrightStatus: "restricted" })).toBeNull();
  });

  it("parses immutable document ids and rejects invalid versions", () => {
    expect(parseMediaDocumentId("media.fixture.cafe@2")).toEqual({ stableKey: "media.fixture.cafe", version: 2 });
    expect(() => parseMediaDocumentId("media.fixture.cafe@0")).toThrow("MEDIA_ID_INVALID");
  });

  it("rejects expired playback and returns only approved bounded segments", () => {
    const now = new Date("2026-09-13T10:00:00.000Z");
    expect(() => projectMediaPlayback({ card: projectMediaCard(raw)!, asset: {
      kind: "official_embed", url: "https://player.example.test/embed/1", expiresAt: new Date("2026-09-13T09:00:00.000Z"),
    }, segments: [] }, now)).toThrow(MediaUnavailableError);
    expect(projectMediaPlayback({ card: projectMediaCard(raw)!, asset: {
      kind: "official_embed", url: "https://player.example.test/embed/1", expiresAt: null,
    }, segments: [
      { id: "segment-1", index: 0, startMs: 0, endMs: 1_500, sourceText: "Buenos días.", translation: "早上好。", speaker: null, reviewStatus: "approved" },
      { id: "segment-2", index: 1, startMs: 1_500, endMs: 3_000, sourceText: "Borrador", translation: null, speaker: null, reviewStatus: "pending" },
    ] }, now)).toMatchObject({ segments: [{ id: "segment-1" }] });
  });

  it("keeps diarization indexes out of the learner-facing playback projection", () => {
    const now = new Date("2026-09-13T10:00:00.000Z");
    const playback = projectMediaPlayback({ card: projectMediaCard(raw)!, asset: {
      kind: "official_embed", url: "https://player.example.test/embed/1", expiresAt: null,
    }, segments: [
      { id: "segment-1", index: 0, startMs: 0, endMs: 1_500, sourceText: "Buenos días.", translation: "早上好。", speaker: "S1", reviewStatus: "approved" },
      { id: "segment-2", index: 1, startMs: 1_500, endMs: 3_000, sourceText: "¿Qué tal?", translation: "你好吗？", speaker: " s 2 ", reviewStatus: "approved" },
      { id: "segment-3", index: 2, startMs: 3_000, endMs: 4_500, sourceText: "Hasta luego.", translation: "回头见。", speaker: "Speaker_11", reviewStatus: "approved" },
      { id: "segment-4", index: 3, startMs: 4_500, endMs: 6_000, sourceText: "Hasta mañana.", translation: "明天见。", speaker: "Lucía", reviewStatus: "approved" },
    ] }, now);
    expect(playback.segments.map((segment) => segment.speaker)).toEqual([null, null, null, "Lucía"]);
    expect(playback.segments.map((segment) => segment.sourceText)).toEqual(["Buenos días.", "¿Qué tal?", "Hasta luego.", "Hasta mañana."]);
  });
});
