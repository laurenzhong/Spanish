import { describe, expect, it, vi } from "vitest";

import { listSavedShelfItems } from "@/src/modules/reading/application/list-saved-items";
import type { SavedArticleItem, SavedReadingItem } from "@/src/modules/reading/domain/saved-items";
import type { ReadingRepository } from "@/src/modules/reading/repositories/reading-repository";

const userId = "00000000-0000-4000-8000-000000000001";

function article(index: number): SavedArticleItem {
  return {
    articleId: `article.shelf-${index}@1`,
    stableKey: `article.shelf-${index}`,
    version: 1,
    title: `Historia ${index}`,
    sourceName: "Sueño Editorial",
    sourceUrl: null,
    itemType: "article",
    origin: "public",
    saved: true,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
  };
}

function annotation(index: number): SavedReadingItem {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    articleId: `article.shelf-${index}@1`,
    stableKey: `article.shelf-${index}`,
    version: 1,
    title: `Historia ${index}`,
    sourceName: "Sueño Editorial",
    sourceUrl: null,
    itemType: "highlight",
    text: `frase ${index}`,
    position: index,
    context: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 30 + index)),
  };
}

/** Thirty article rows (all older) and thirty annotations (all newer). */
function fakeRepository() {
  const articles = Array.from({ length: 30 }, (_, index) => article(index));
  const annotations = Array.from({ length: 30 }, (_, index) => annotation(index));
  const listSavedArticleShelf = vi.fn(async (_userId: string, query: { page: number; pageSize: number }) => ({
    items: articles.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: articles.length,
  }));
  const listSavedItems = vi.fn(async (_userId: string, query: { page: number; pageSize: number; itemType?: string }) => {
    const rows = query.itemType ? [] : annotations;
    return {
      items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: rows.length,
    };
  });
  const repository = { listSavedArticleShelf, listSavedItems } as unknown as ReadingRepository;
  return { listSavedArticleShelf, listSavedItems, repository };
}

describe("saved shelf adapter", () => {
  it("reads a single source for each type tab", async () => {
    const { listSavedArticleShelf, listSavedItems, repository } = fakeRepository();

    await expect(listSavedShelfItems(repository, userId, { itemType: "article", page: 2, pageSize: 10 }))
      .resolves.toMatchObject({ page: 2, pageSize: 10, total: 30 });
    expect(listSavedArticleShelf).toHaveBeenCalledWith(userId, { search: undefined, page: 2, pageSize: 10 });
    expect(listSavedItems).not.toHaveBeenCalled();

    listSavedArticleShelf.mockClear();
    await listSavedShelfItems(repository, userId, { itemType: "phrase", page: 1, pageSize: 10 });
    expect(listSavedItems).toHaveBeenCalledWith(userId, { search: undefined, itemType: "phrase", page: 1, pageSize: 10 });
    expect(listSavedArticleShelf).not.toHaveBeenCalled();
  });

  it("merges 全部 newest-first from the top of both sources", async () => {
    const { listSavedArticleShelf, listSavedItems, repository } = fakeRepository();

    const first = await listSavedShelfItems(repository, userId, { page: 1, pageSize: 24 });
    expect(first.total).toBe(60);
    expect(first.items).toHaveLength(24);
    // Annotations carry the newer timestamps, so page 1 is annotations only.
    expect(first.items.every((item) => item.itemType === "highlight")).toBe(true);
    expect(listSavedArticleShelf).toHaveBeenCalledWith(userId, { search: undefined, page: 1, pageSize: 24 });
    expect(listSavedItems).toHaveBeenCalledWith(userId, { search: undefined, itemType: undefined, page: 1, pageSize: 24 });

    listSavedArticleShelf.mockClear();
    listSavedItems.mockClear();
    const second = await listSavedShelfItems(repository, userId, { page: 2, pageSize: 24 });
    // Page 2 needs the newest 48 rows of each source, then one global slice.
    expect(listSavedArticleShelf).toHaveBeenCalledWith(userId, { search: undefined, page: 1, pageSize: 48 });
    expect(listSavedItems).toHaveBeenCalledWith(userId, { search: undefined, itemType: undefined, page: 1, pageSize: 48 });
    expect(second.items).toHaveLength(24);
    expect(second.items.slice(0, 6).every((item) => item.itemType === "highlight")).toBe(true);
    expect(second.items.slice(6).every((item) => item.itemType === "article")).toBe(true);
    // Merged order is strictly newest-first across the page boundary.
    const timestamps = second.items.map((item) => item.createdAt.getTime());
    expect(timestamps).toEqual([...timestamps].sort((left, right) => right - left));
  });

  it("caps the merged window and rejects an unknown item type", async () => {
    const { listSavedArticleShelf, listSavedItems, repository } = fakeRepository();

    await listSavedShelfItems(repository, userId, { page: 1000, pageSize: 50 });
    expect(listSavedArticleShelf).toHaveBeenCalledWith(userId, { search: undefined, page: 1, pageSize: 500 });
    expect(listSavedItems).toHaveBeenCalledWith(userId, { search: undefined, itemType: undefined, page: 1, pageSize: 500 });

    await expect(listSavedShelfItems(repository, userId, { itemType: "word" as never, page: 1, pageSize: 24 })).rejects.toThrow();
  });
});
