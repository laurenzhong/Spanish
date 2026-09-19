import { describe, expect, it, vi } from "vitest";

import { CompositeArticleRepository } from "@/src/modules/content/repositories/composite-article-repository";

const article = {
  id: "article.bundle@1",
  stableKey: "article.bundle",
  version: 1,
  locale: "es-ES",
  title: "Contenido local",
  summary: "Resumen",
  sourceName: "Sueño",
  author: undefined,
  publicationDate: undefined,
  copyrightStatus: "cleared" as const,
  sourceUrl: undefined,
  attribution: undefined,
  cefr: "A2" as const,
  topics: ["topic.daily-life"],
  region: null,
  format: "story" as const,
  estimatedReadingMinutes: 2,
  oralTransferType: "opinion" as const,
  contentHash: "hash",
};

describe("CompositeArticleRepository", () => {
  it("keeps successful sources available when another source fails", async () => {
    const failingRepository = { list: vi.fn().mockRejectedValue(new Error("database unavailable")) };
    const workingRepository = { list: vi.fn().mockResolvedValue({
      articles: [article],
      totalCount: 1,
      topics: article.topics,
      nextCursor: null,
      hasMore: false,
      savedFilterAvailable: false,
    }) };
    const repository = new CompositeArticleRepository([failingRepository, workingRepository]);

    await expect(repository.list({ pageSize: 12 })).resolves.toMatchObject({
      articles: [article],
      totalCount: 1,
    });
  });

  it("continues article lookup when an earlier source is unavailable", async () => {
    const failingRepository = { findById: vi.fn().mockRejectedValue(new Error("database unavailable")) };
    const workingRepository = { findById: vi.fn().mockResolvedValue({ article, reason: "found" as const }) };
    const repository = new CompositeArticleRepository([failingRepository, workingRepository]);

    await expect(repository.findById(article.id)).resolves.toEqual({ article, reason: "found" });
  });
});
