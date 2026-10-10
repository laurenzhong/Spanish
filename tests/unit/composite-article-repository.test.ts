import { describe, expect, it } from "vitest";

import { CompositeArticleRepository } from "@/src/modules/content/repositories/composite-article-repository";

const article = {
  id: "bundle.article@1",
  stableKey: "bundle.article",
  version: 1,
  locale: "es-ES",
  title: "Artículo de prueba",
  summary: "Contenido local.",
  cefr: "B1" as const,
  topics: ["topic.daily-life"],
  region: "es-ES",
  register: "neutral",
  format: "essay" as const,
  estimatedReadingMinutes: 4,
  sourceName: "Bundle",
  author: null,
  publicationDate: null,
  assets: { audio: false, chineseSummary: false, wordHelp: false, image: false },
  oralTransferType: "none" as const,
  contentHash: "hash",
  sourceUrl: null,
  attribution: null,
  segments: [{ position: 0, text: "Contenido local." }],
};

describe("CompositeArticleRepository", () => {
  it("keeps local articles available when a remote source fails", async () => {
    const local = { list: async () => ({ articles: [article], totalCount: 1, topics: article.topics, nextCursor: null, hasMore: false, savedFilterAvailable: false }) };
    const unavailable = { list: async () => { throw new Error("database unavailable"); } };

    await expect(new CompositeArticleRepository([local, unavailable], 20).list()).resolves.toMatchObject({
      articles: [article],
      totalCount: 1,
    });
  });

  it("times out a stalled source instead of blocking the shelf", async () => {
    const local = { list: async () => ({ articles: [article], totalCount: 1, topics: article.topics, nextCursor: null, hasMore: false, savedFilterAvailable: false }) };
    const stalled = { list: () => new Promise<never>(() => undefined) };
    const startedAt = Date.now();
    await expect(new CompositeArticleRepository([local, stalled], 20).list()).resolves.toMatchObject({ articles: [article] });
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("times out a stalled detail source and keeps the local article available", async () => {
    const local = { list: async () => ({ articles: [], totalCount: 0, topics: [], nextCursor: null, hasMore: false, savedFilterAvailable: false }), findById: async () => ({ article, reason: "found" as const }) };
    const stalled = { list: async () => ({ articles: [], totalCount: 0, topics: [], nextCursor: null, hasMore: false, savedFilterAvailable: false }), findById: () => new Promise<never>(() => undefined) };
    const startedAt = Date.now();

    await expect(new CompositeArticleRepository([stalled, local], 20).findById(article.id)).resolves.toEqual({
      article,
      reason: "found",
    });
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
