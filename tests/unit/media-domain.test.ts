// @vitest-environment node

import { describe, expect, it } from "vitest";

import { MediaUnavailableError, parseMediaDocumentId, projectMediaCard, projectMediaPlayback } from "@/src/modules/media";

const raw = {
  stableKey: "media.fixture.cafe", version: 2, kind: "video" as const,
  title: "Conversaciones en una cafetería", summary: "Una conversación breve y natural.",
  sourceName: "Canal de ejemplo", language: "es", region: "es-ES", cefr: "A2" as const,
  topics: ["topic.daily-life"], durationMs: 185_000,
  publishedAt: new Date("2026-09-12T08:00:00.000Z"), curatedAt: new Date("2026-09-13T08:00:00.000Z"),
  contentHash: "a".repeat(64), status: "published" as const, copyrightStatus: "cleared" as const, playable: true,
};

describe("media domain", () => {
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

  it("keeps valid artwork, but degrades malformed or expired artwork to null", () => {
    const now = new Date("2026-09-13T10:00:00.000Z");
    const artwork = { url: "https://images.example.test/cafe.jpg", alt: "Conversación en una cafetería", source: "youtube" as const, width: 1280, height: 720, expiresAt: null };
    expect(projectMediaCard({ ...raw, artwork }, now)?.artwork).toEqual(artwork);
    expect(projectMediaCard({ ...raw, artwork: { ...artwork, url: "http://images.example.test/cafe.jpg" } }, now)?.artwork).toBeNull();
    expect(projectMediaCard({ ...raw, artwork: { ...artwork, expiresAt: new Date("2026-09-13T09:00:00.000Z") } }, now)?.artwork).toBeNull();
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
});
