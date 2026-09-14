// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  normalizeArticleCandidate,
  prepareArticleCandidateForReview,
  type ContentAcquisitionRepository,
  type ContentCandidateRecord,
} from "@/src/modules/content-acquisition";

function articleMetadata() {
  return normalizeArticleCandidate({
    sourceStableKey: "news.example",
    externalItemId: "article-1",
    canonicalUrl: "https://news.example.test/article-1",
    title: "Una noticia",
    summary: "Resumen breve.",
    author: null,
    publishedAt: null,
    fetchedAt: "2026-09-13T00:00:00.000Z",
    paragraphs: ["Primer párrafo."],
    source: { sourceName: "Noticias", sourceType: "licensed", license: "licensed", attribution: "Noticias", licenseEvidence: "https://news.example.test/licencia" },
    defaults: { cefr: "B1", topics: ["topic.news"], region: "es-ES", register: "neutral", format: "news", oralTransferType: "opinion" },
  });
}

describe("article candidate processing", () => {
  it("validates the immutable draft, resumes legal states and reaches review_ready", async () => {
    const item = articleMetadata();
    let current: ContentCandidateRecord = {
      id: "00000000-0000-4000-8000-000000000811",
      sourceId: "00000000-0000-4000-8000-000000000812",
      externalItemId: item.externalItemId,
      normalizedUrl: item.canonicalUrl,
      title: item.title,
      contentType: "article",
      language: "es",
      publishedAt: null,
      contentHash: item.contentHash,
      metadata: item.metadata,
      status: "screened",
      rightsStatus: "verified",
      generationId: "generation-1",
      revision: 2,
      lastActivityAt: new Date(),
      rejectedAt: null,
      publicationStatus: "draft",
      publicationRef: null,
      publishedCandidateRevision: null,
      publishedContentHash: null,
      publishedAtInternal: null,
      archivedAt: null,
    };
    const recordProcessingAttempt = vi.fn(async () => undefined);
    const repository = {
      findCandidateById: vi.fn(async () => current),
      compareAndSwapCandidate: vi.fn(async (input) => {
        current = { ...current, status: input.status, revision: input.expectedRevision + 1, lastActivityAt: input.updatedAt };
        return current;
      }),
      recordProcessingAttempt,
    } as unknown as ContentAcquisitionRepository;

    await expect(prepareArticleCandidateForReview(repository, current.id, {
      makeAttemptId: () => "00000000-0000-4000-8000-000000000813",
      now: () => new Date("2026-09-13T01:00:00.000Z"),
    })).resolves.toMatchObject({ status: "review_ready", revision: 5 });
    expect(recordProcessingAttempt).toHaveBeenCalledWith(expect.objectContaining({
      jobType: "article-normalization",
      status: "succeeded",
      estimatedCostMicros: 0,
    }));
  });
});
