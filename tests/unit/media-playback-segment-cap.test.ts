// @vitest-environment node
import { describe, expect, it } from "vitest";
import { findSegmentIndexAt, projectMediaCard, projectMediaPlayback } from "@/src/modules/media/domain";

const card = projectMediaCard({
  stableKey: "media.fixture.long", version: 1, kind: "video",
  title: "Long video", summary: "Transcript fixture", sourceName: "Fixture",
  language: "es", region: "es-ES", cefr: "A2", topics: [], durationMs: 1_100_000,
  publishedAt: new Date("2026-09-12"), curatedAt: new Date("2026-09-13"),
  contentHash: "a".repeat(64), status: "published", copyrightStatus: "cleared", playable: true,
})!;

describe("complete playback transcript", () => {
  it.each([501, 848, 1025])("returns all %i approved cues and their tail word timings", (count) => {
    const segments = Array.from({ length: count }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      index, startMs: index * 1_000, endMs: (index + 1) * 1_000,
      sourceText: "Sí.", translation: "是。", speaker: null, reviewStatus: "approved" as const,
      words: [{ text: "Sí", startOffset: 0, endOffset: 2, startMs: index * 1_000, endMs: (index + 1) * 1_000 }],
    }));
    const playback = projectMediaPlayback({ card, asset: { kind: "video", url: "https://fixture.test/video.mp4", expiresAt: null }, segments: [
      ...segments.slice(0, 250),
      { ...segments[250]!, id: "pending", reviewStatus: "pending" },
      ...segments.slice(250),
    ] });
    expect(playback.segments).toHaveLength(count);
    expect(playback.segments.map((segment) => segment.index)).toEqual(segments.map((segment) => segment.index));
    expect(playback.segments.at(-1)).toMatchObject({ index: count - 1, words: segments.at(-1)!.words });
    expect(findSegmentIndexAt(playback.segments, (count - 1) * 1_000 + 100)).toBe(count - 1);
    expect(playback.segments.some((segment) => segment.id === "pending")).toBe(false);
  });
});
