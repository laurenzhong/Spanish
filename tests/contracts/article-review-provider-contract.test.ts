import { describe, expect, it } from "vitest";

import {
  articleReviewInputHash,
  articleReviewResultSchema,
  createDefaultArticleReviewProviders,
  type ArticleReviewInput,
} from "@/src/modules/content-acquisition/providers/article-review";

const input: ArticleReviewInput = {
  candidateId: "candidate-contract",
  candidateRevision: 2,
  contentHash: "a".repeat(64),
  title: "Una noticia",
  summary: "Resumen breve.",
  paragraphs: ["Texto en español."],
  draft: {
    stableKey: "article.contract",
    locale: "es-ES",
    title: "Una noticia",
    summary: "Resumen breve.",
    author: null,
    canonicalUrl: "https://example.test/article",
    publicationDate: "2026-09-18",
    sourceName: "Fuente",
    sourceType: "licensed",
    license: "licensed",
    attribution: "Fuente",
    licenseEvidence: "https://example.test/license",
    copyrightStatus: "cleared",
    fetchedAt: "2026-09-18T00:00:00.000Z",
    contentHash: "a".repeat(64),
    cefr: "B1",
    topics: ["daily-life"],
    region: "ES",
    register: "neutral",
    format: "news",
    estimatedReadingMinutes: 1,
    oralTransferType: "summary",
    paragraphs: ["Texto en español."],
    changeReason: "Fixture.",
  },
};

describe("article review provider contract", () => {
  it("keeps both dimensions independent and bound to the frozen input hash", async () => {
    const providers = createDefaultArticleReviewProviders();
    const [content, teaching] = await Promise.all([
      providers.content.review(input),
      providers.teaching.review(input),
    ]);

    expect(content.inputHash).toBe(articleReviewInputHash(input));
    expect(teaching.inputHash).toBe(content.inputHash);
    expect(content.modelVersion).not.toBe(teaching.modelVersion);
    expect(articleReviewResultSchema.parse(content).decision).toBe("approved");
    expect(articleReviewResultSchema.parse(teaching).decision).toBe("approved");
  });
});
