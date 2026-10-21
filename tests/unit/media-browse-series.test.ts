import { describe, expect, it } from "vitest";

import type { MediaCard } from "@/src/modules/media/domain/media";
import { selectMediaBrowsePage } from "@/src/modules/media/domain/media-browse";

function card(key: string, seriesKey: string | null = null): MediaCard {
  return { id: `${key}@1`, stableKey: key, version: 1, kind: "video", title: key, summary: "", sourceName: "The same display name",
    language: "es", region: "es-ES", cefr: "B1", topics: [], durationMs: 60000, publishedAt: null,
    curatedAt: "2026-10-16T00:00:00.000Z", contentHash: "a".repeat(64), progress: null,
    series: seriesKey ? { seriesKey, title: "Identical series display title", kind: "video", orderMode: "ordered", revision: 1, seasonNumber: null, episodeNumber: null, episodeLabel: null } : null };
}
const query = { filters: {}, seed: "00000000-0000-4000-8000-000000000001", exclude: [] as string[], pageSize: 20 };
const collection = [
  ...Array.from({ length: 8 }, (_, index) => card(`video.alpha.${index + 1}`, "series.alpha")),
  ...Array.from({ length: 3 }, (_, index) => card(`video.beta.${index + 1}`, "series.beta")),
  card("video.gamma.1", "series.gamma"),
];
const singleSource = new Map(collection.map((item) => [item.stableKey, "youtube-channel:official"]));

describe("source and series browse diversity", () => {
  it("rotates distinct series inside a source before later episodes and retains the full inventory", () => {
    const result = selectMediaBrowsePage(collection, query, singleSource);
    expect(new Set(result.items.slice(0, 3).map((item) => item.series!.seriesKey))).toEqual(new Set(["series.alpha", "series.beta", "series.gamma"]));
    expect(result.items).toHaveLength(collection.length);
    expect(new Set(result.items.map((item) => item.stableKey)).size).toBe(collection.length);
    expect(result.items.filter((item) => item.series?.seriesKey === "series.alpha")).toHaveLength(8);
    expect(result.hasMore).toBe(false);
  });

  it("rotates stable sources first, even when unrelated sources have the same display name", () => {
    const inventory = [...collection, card("video.second.a", "series.second.a"), card("video.second.b", "series.second.b")];
    const identities = new Map([...singleSource, ["video.second.a", "youtube-channel:second"], ["video.second.b", "youtube-channel:second"]]);
    const result = selectMediaBrowsePage(inventory, query, identities);
    const firstFourSources = result.items.slice(0, 4).map((item) => identities.get(item.stableKey));
    expect(firstFourSources[0]).not.toBe(firstFourSources[1]);
    expect(firstFourSources[0]).toBe(firstFourSources[2]);
    expect(firstFourSources[1]).toBe(firstFourSources[3]);
    for (const identity of new Set(firstFourSources)) {
      expect(new Set(result.items.filter((item) => identities.get(item.stableKey) === identity).slice(0, 2).map((item) => item.series?.seriesKey)).size).toBe(2);
    }
    expect(result.items).toHaveLength(inventory.length);
  });

  it("treats every ungrouped episode as a separate series group", () => {
    const singles = [card("video.single.1"), card("video.single.2")];
    const inventory = [...collection.slice(0, 8), ...singles];
    const identities = new Map(inventory.map((item) => [item.stableKey, "youtube-channel:official"]));
    const firstThree = selectMediaBrowsePage(inventory, query, identities).items.slice(0, 3);
    expect(firstThree.filter((item) => item.series !== null)).toHaveLength(1);
    expect(firstThree.filter((item) => item.series === null).map((item) => item.stableKey).sort()).toEqual(singles.map((item) => item.stableKey));
  });

  it("uses independent identities when source metadata is absent and never groups by display name", () => {
    const first = selectMediaBrowsePage(collection, { ...query, pageSize: 4 });
    const renamed = collection.map((item, index) => ({ ...item, sourceName: `Renamed ${index % 3}` }));
    expect(selectMediaBrowsePage(renamed, { ...query, pageSize: 4 }).items.map((item) => item.stableKey)).toEqual(first.items.map((item) => item.stableKey));
    expect(selectMediaBrowsePage(renamed, { ...query, pageSize: 4, cursor: first.nextCursor! }).items).toHaveLength(4);
  });

  it("keeps complete, stable, duplicate-free pages with exclusions and imbalanced series", () => {
    const excluded = [collection[1].stableKey, collection[9].stableKey];
    for (const pageSize of [1, 2, 5, 20]) {
      const request = { ...query, pageSize, exclude: excluded, filters: { region: "es-ES", kind: "video" } };
      const first = selectMediaBrowsePage([...collection, collection[0]], request, singleSource);
      expect(selectMediaBrowsePage([...collection].reverse(), request, singleSource)).toEqual(first);
      const all = [...first.items];
      let cursor = first.nextCursor;
      for (let round = 0; cursor && round < collection.length; round++) {
        const next = selectMediaBrowsePage(collection, { ...request, cursor }, singleSource);
        all.push(...next.items);
        cursor = next.nextCursor;
      }
      expect(cursor).toBeNull();
      expect(all).toHaveLength(collection.length - excluded.length);
      expect(new Set(all.map((item) => item.stableKey)).size).toBe(all.length);
      expect(all.every((item) => !excluded.includes(item.stableKey))).toBe(true);
    }
  });

  it("invalidates cursors for source, series and revision changes even when order is identical", () => {
    const inventory = collection.slice(0, 8);
    const request = { ...query, pageSize: 2 };
    const first = selectMediaBrowsePage(inventory, request, singleSource);
    for (const changed of [
      inventory.map((item) => ({ ...item, series: { ...item.series!, revision: 2 } })),
      inventory.map((item) => ({ ...item, series: { ...item.series!, seriesKey: "series.renamed" } })),
      inventory.map((item) => ({ ...item, series: null })),
    ]) expect(() => selectMediaBrowsePage(changed, { ...request, cursor: first.nextCursor! }, singleSource)).toThrow("MEDIA_CURSOR_INVALID");
    const changedSource = new Map(inventory.map((item) => [item.stableKey, "youtube-channel:corrected"]));
    expect(() => selectMediaBrowsePage(inventory, { ...request, cursor: first.nextCursor! }, changedSource)).toThrow("MEDIA_CURSOR_INVALID");
    expect(() => selectMediaBrowsePage(inventory, { ...request, pageSize: 3, cursor: first.nextCursor! }, singleSource)).toThrow("MEDIA_CURSOR_INVALID");
  });

  it("binds catalogue revision changes for excluded entries without using user progress as a fingerprint", () => {
    const request = { ...query, pageSize: 2, exclude: [collection[0].stableKey] };
    const first = selectMediaBrowsePage(collection, request, singleSource);
    const changed = collection.map((item, index) => index ? item : { ...item, series: { ...item.series!, revision: 2 } });
    expect(() => selectMediaBrowsePage(changed, { ...request, cursor: first.nextCursor! }, singleSource)).toThrow("MEDIA_CURSOR_INVALID");
    const otherUserProgress = collection.map((item) => ({ ...item, progress: { status: "in_progress" as const, lastPositionMs: 1000, lastSegmentIndex: null, revision: 1 } }));
    expect(() => selectMediaBrowsePage(otherUserProgress, { ...request, cursor: first.nextCursor! }, singleSource)).not.toThrow();
  });
});
