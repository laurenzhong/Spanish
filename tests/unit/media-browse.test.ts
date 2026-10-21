import { describe, expect, it } from "vitest";
import { selectMediaBrowsePage } from "@/src/modules/media/domain/media-browse";
import type { MediaCard } from "@/src/modules/media/domain";

const cards: MediaCard[] = Array.from({ length: 60 }, (_, index) => ({
  id: `media.test.${index}@1`, stableKey: `media.test.${index}`, version: 1,
  kind: "podcast", title: `Episode ${index}`, summary: "", sourceName: `Source ${index % 3}`,
  language: "es", region: "es-ES", cefr: "B1", topics: [], durationMs: 60_000,
  publishedAt: null, curatedAt: "2026-10-13T00:00:00.000Z", contentHash: "a".repeat(64), progress: null,
}));
const query = { filters: {}, seed: "00000000-0000-4000-8000-000000000001", exclude: [], pageSize: 24 };
const sourceIdentities = new Map(cards.map((card, index) => [card.stableKey, `podcast-feed:fixture-${index % 3}`]));

describe("media browse batches", () => {
  it("selects beyond the current page, excludes seen stable identities and balances sources", () => {
    const page = selectMediaBrowsePage(cards, { ...query, exclude: cards.slice(0, 24).map((card) => card.stableKey) }, sourceIdentities);
    expect(page.items).toHaveLength(24);
    expect(page.items.every((card) => !cards.slice(0, 24).some((seen) => seen.stableKey === card.stableKey))).toBe(true);
    for (const source of ["Source 0", "Source 1", "Source 2"]) {
      expect(page.items.filter((card) => card.sourceName === source)).toHaveLength(8);
    }
  });

  it("keeps all pages deterministic, complete and duplicate-free", () => {
    const first = selectMediaBrowsePage(cards, query, sourceIdentities);
    expect(selectMediaBrowsePage([...cards].reverse(), query, sourceIdentities)).toEqual(first);
    const second = selectMediaBrowsePage(cards, { ...query, cursor: first.nextCursor! }, sourceIdentities);
    const third = selectMediaBrowsePage(cards, { ...query, cursor: second.nextCursor! }, sourceIdentities);
    const all = [...first.items, ...second.items, ...third.items];
    expect(new Set(all.map((card) => card.id)).size).toBe(60);
    expect(third).toMatchObject({ hasMore: false, nextCursor: null });
    expect(selectMediaBrowsePage(cards, { ...query, seed: "00000000-0000-4000-8000-000000000002" }, sourceIdentities).items).not.toEqual(first.items);
  });

  it("rejects stale or mismatched cursors instead of silently changing a batch", () => {
    const first = selectMediaBrowsePage(cards, query, sourceIdentities);
    for (const changed of [
      { ...query, seed: "different" }, { ...query, filters: { kind: "podcast" as const } },
      { ...query, exclude: [cards[0].stableKey] },
    ]) expect(() => selectMediaBrowsePage(cards, { ...changed, cursor: first.nextCursor! }, sourceIdentities)).toThrow("MEDIA_CURSOR_INVALID");
    expect(() => selectMediaBrowsePage(cards.slice(1), { ...query, cursor: first.nextCursor! }, sourceIdentities)).toThrow("MEDIA_CURSOR_INVALID");
    expect(() => selectMediaBrowsePage(cards, { ...query, cursor: "garbage" }, sourceIdentities)).toThrow("MEDIA_CURSOR_INVALID");
  });

  it("reports exhaustion without recycling or inventing content", () => {
    expect(selectMediaBrowsePage(cards, { ...query, exclude: cards.map((card) => card.stableKey) })).toEqual({ items: [], hasMore: false, nextCursor: null });
    expect(selectMediaBrowsePage([], query).items).toEqual([]);
  });
});
