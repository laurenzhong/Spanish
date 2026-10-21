// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  MediaSeriesError,
  recommendMediaSeriesEpisodes,
  sortMediaSeriesEpisodes,
  validateMediaSeriesCommand,
  type MediaSeriesEpisode,
  type SaveMediaSeriesCommand,
} from "@/src/modules/media/domain/media-series";
import { mediaSeriesEpisodesQuerySchema, saveMediaSeriesCommandSchema } from "@/src/modules/media/schemas/media-series";

const command: SaveMediaSeriesCommand = {
  idempotencyKey: "series-import-001", expectedRevision: 0,
  title: "Historias de Madrid", summary: "Historias breves del programa oficial.",
  kind: "video", orderMode: "ordered", status: "active",
  reason: "Confirmed against the official programme list.", evidence: ["https://example.test/programme"],
  members: [{ stableKey: "video.madrid.01", position: 1, seasonNumber: null, episodeNumber: null, episodeLabel: null, evidence: ["https://example.test/programme/1"] }],
  removeStableKeys: [], fromSeriesRevisions: {},
};
const episode = (key: string, position: number | null, publishedAt: string | null = null): MediaSeriesEpisode => ({
  stableKey: key, seriesKey: "series.madrid", kind: "video", position, publishedAt,
});

describe("media series command rules", () => {
  it("keeps unknown episode metadata null and accepts gaps in confirmed ordering", () => {
    expect(() => validateMediaSeriesCommand(command)).not.toThrow();
    expect(saveMediaSeriesCommandSchema.parse(command).members[0]).toMatchObject({ seasonNumber: null, episodeNumber: null, episodeLabel: null });
    expect(() => validateMediaSeriesCommand({ ...command, members: [command.members[0], { ...command.members[0], stableKey: "video.madrid.03", position: 3 }] })).not.toThrow();
  });

  it("preserves official season zero and episode zero while retaining null for unknown metadata", () => {
    const special = { ...command, members: [{ ...command.members[0], seasonNumber: 0, episodeNumber: 0 }] };
    expect(() => validateMediaSeriesCommand(special)).not.toThrow();
    expect(saveMediaSeriesCommandSchema.parse(special).members[0]).toMatchObject({ seasonNumber: 0, episodeNumber: 0 });
    for (const invalid of [-1, 0.5, 2_147_483_648]) {
      expect(saveMediaSeriesCommandSchema.safeParse({ ...command, members: [{ ...command.members[0], seasonNumber: invalid }] }).success).toBe(false);
      expect(saveMediaSeriesCommandSchema.safeParse({ ...command, members: [{ ...command.members[0], episodeNumber: invalid }] }).success).toBe(false);
    }
  });

  it("rejects duplicate members, removals and conflicting changes", () => {
    for (const invalid of [
      { ...command, members: [command.members[0], command.members[0]] },
      { ...command, removeStableKeys: ["video.other.01", "video.other.01"] },
      { ...command, removeStableKeys: [command.members[0].stableKey] },
    ]) expect(() => validateMediaSeriesCommand(invalid)).toThrow(MediaSeriesError);
  });

  it("requires unique positive ordered positions, but allows unknown episodic positions", () => {
    for (const position of [null, 0, -1, 1.5]) {
      expect(saveMediaSeriesCommandSchema.safeParse({ ...command, members: [{ ...command.members[0], position }] }).success).toBe(false);
    }
    expect(saveMediaSeriesCommandSchema.safeParse({ ...command, members: [command.members[0], { ...command.members[0], stableKey: "video.madrid.02" }] }).success).toBe(false);
    expect(saveMediaSeriesCommandSchema.safeParse({ ...command, orderMode: "episodic", members: [{ ...command.members[0], position: null }] }).success).toBe(true);
  });

  it("bounds all external data, rejects unknown payloads and credential-bearing audit evidence", () => {
    for (const invalid of [
      { ...command, expectedRevision: -1 }, { ...command, expectedRevision: Number.MAX_SAFE_INTEGER },
      { ...command, title: "x".repeat(201) }, { ...command, transcript: "private dialogue" },
      { ...command, members: Array.from({ length: 501 }, (_, index) => ({ ...command.members[0], stableKey: `video.item.${index}`, position: index + 1 })) },
      { ...command, evidence: ["https://example.test/play?X-Amz-Signature=secret"] },
      { ...command, evidence: ["https://example.test/play?token=secret"] },
      { ...command, evidence: ["https://example.test/play?%74oken=secret"] },
      { ...command, evidence: ["https://owner@example.test/programme"] },
      { ...command, evidence: ["https://owner:secret@example.test/programme"] },
      { ...command, evidence: ["data:audio/wav;base64,secret"] },
      { ...command, reason: "Bearer abcdef123456" },
      { ...command, members: [{ ...command.members[0], episodeNumber: -1 }] },
      { ...command, fromSeriesRevisions: { "invalid series": 1 } },
    ]) expect(saveMediaSeriesCommandSchema.safeParse(invalid).success).toBe(false);
  });

  it("requires audit references and explicit source revisions for moves", () => {
    expect(saveMediaSeriesCommandSchema.safeParse({ ...command, evidence: [] }).success).toBe(false);
    expect(saveMediaSeriesCommandSchema.safeParse({ ...command, members: [{ ...command.members[0], evidence: [] }] }).success).toBe(false);
    expect(saveMediaSeriesCommandSchema.safeParse({ ...command, fromSeriesRevisions: { "series.previous": 2 } }).success).toBe(true);
    expect(saveMediaSeriesCommandSchema.safeParse({ ...command, fromSeriesRevisions: { "series.previous": 0 } }).success).toBe(false);
  });

  it("parses bounded pagination without silently accepting unknown query parameters", () => {
    expect(mediaSeriesEpisodesQuerySchema.parse({})).toEqual({ pageSize: 20 });
    expect(mediaSeriesEpisodesQuerySchema.parse({ pageSize: 50, anchorMediaKey: "video.madrid.01" }).pageSize).toBe(50);
    for (const query of [{ pageSize: 51 }, { cursor: "" }, { cursor: "x".repeat(2001) }, { pageSize: "20" }, { arbitrary: true }]) {
      expect(mediaSeriesEpisodesQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe("media series ordering and fixed recommendations", () => {
  it("sorts confirmed positions and breaks ties deterministically without mutating input", () => {
    const episodes = [episode("video.c", 3), episode("video.b", 1), episode("video.a", 1)];
    expect(sortMediaSeriesEpisodes("ordered", episodes).map((item) => item.stableKey)).toEqual(["video.a", "video.b", "video.c"]);
    expect(episodes[0].stableKey).toBe("video.c");
  });

  it("sorts independent episodes by actual dates, then stable keys, with missing dates last", () => {
    const episodes = [episode("video.unknown", null), episode("video.b", null, "2026-01-02T00:00:00Z"), episode("video.a", null, "2026-01-02T01:00:00+01:00"), episode("video.old", null, "2025-01-01T00:00:00Z")];
    expect(sortMediaSeriesEpisodes("episodic", episodes).map((item) => item.stableKey)).toEqual(["video.a", "video.b", "video.old", "video.unknown"]);
  });

  it("prefers later visible episodes and fills from earlier episodes with a hard six-card cap", () => {
    const episodes = Array.from({ length: 10 }, (_, index) => episode(`video.item.${index + 1}`, index + 1));
    const options = { series: { seriesKey: "series.madrid", kind: "video" as const, orderMode: "ordered" as const, status: "active" as const }, currentStableKey: "video.item.5", episodes };
    expect(recommendMediaSeriesEpisodes(options).map((item) => item.position)).toEqual([6, 7, 8, 9, 10, 1]);
    expect(recommendMediaSeriesEpisodes({ ...options, limit: 100 })).toHaveLength(6);
    expect(recommendMediaSeriesEpisodes({ ...options, currentStableKey: "video.item.10" }).map((item) => item.position)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("excludes the current stable ID, other series, podcasts and duplicates", () => {
    const episodes = [episode("video.current", 1), episode("video.next", 2), episode("video.next", 2), { ...episode("video.other", 3), seriesKey: "series.other" }, { ...episode("podcast.other", 4), kind: "podcast" as const }];
    const options = { series: { seriesKey: "series.madrid", kind: "video" as const, orderMode: "ordered" as const, status: "active" as const }, currentStableKey: "video.current", episodes };
    expect(recommendMediaSeriesEpisodes(options).map((item) => item.stableKey)).toEqual(["video.next"]);
    expect(recommendMediaSeriesEpisodes({ ...options, currentStableKey: "video.missing" })).toEqual([]);
    expect(recommendMediaSeriesEpisodes({ ...options, series: { ...options.series, status: "archived" } })).toEqual([]);
    expect(recommendMediaSeriesEpisodes({ ...options, series: { ...options.series, kind: "podcast" } })).toEqual([]);
  });

  it("does not invent ordering when positions are unknown", () => {
    const episodes = [episode("video.current", null), episode("video.old", null, "2025-01-01T00:00:00Z"), episode("video.new", null, "2026-01-01T00:00:00Z")];
    expect(recommendMediaSeriesEpisodes({ series: { seriesKey: "series.madrid", kind: "video", orderMode: "episodic", status: "active" }, currentStableKey: "video.current", episodes }).map((item) => item.stableKey)).toEqual(["video.new", "video.old"]);
  });
});
