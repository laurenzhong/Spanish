// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  AcquiredArticlePublisher,
  ArticlePublicationConflictError,
  normalizeArticleCandidate,
} from "@/src/modules/content-acquisition";
import type { AcquiredArticleRepository } from "@/src/modules/content/repositories";

function candidate() {
  return normalizeArticleCandidate({
    sourceStableKey: "news.example",
    externalItemId: "article-1",
    canonicalUrl: "https://news.example.test/article-1",
    title: "Una noticia",
    summary: "Resumen breve.",
    author: "María Ejemplo",
    publishedAt: "2026-09-12T06:30:00.000Z",
    fetchedAt: "2026-09-13T00:00:00.000Z",
    paragraphs: ["Primer párrafo.", "Segundo párrafo."],
    source: {
      sourceName: "Noticias de ejemplo",
      sourceType: "creative_commons",
      license: "creative_commons",
      attribution: "Noticias de ejemplo / CC BY 4.0",
      licenseEvidence: "https://news.example.test/licencia",
    },
    defaults: {
      cefr: "B1",
      topics: ["topic.current-events"],
      region: "es-ES",
      register: "neutral",
      format: "news",
      oralTransferType: "opinion",
    },
  });
}

const reviews = [
  { id: "r-es", candidateId: "candidate-1", dimension: "content-es-ES" as const, status: "approved" as const, reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5, notes: "Uso y contenido revisados." },
  { id: "r-zh", candidateId: "candidate-1", dimension: "teaching-zh-CN" as const, status: "approved" as const, reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5, notes: "教学说明已复核。" },
  { id: "r-structure", candidateId: "candidate-1", dimension: "structure" as const, status: "approved" as const, reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5, notes: null },
];

describe("acquired article candidate publisher", () => {
  it("passes an immutable reviewed draft to the content application and returns its reference", async () => {
    const item = candidate();
    const publishAcquired = vi.fn(async () => ({ kind: "article" as const, stableKey: item.metadata.articleDraft.stableKey, version: 1 }));
    const repository = { publishAcquired, archiveAcquired: vi.fn() } as unknown as AcquiredArticleRepository;
    const publisher = new AcquiredArticlePublisher(repository, {
      now: () => new Date("2026-09-13T01:00:00.000Z"),
    });

    await expect(publisher.publish({
      candidateId: "candidate-1",
      candidateRevision: 5,
      contentHash: item.contentHash!,
      contentType: "article",
      title: item.title,
      language: item.language,
      normalizedUrl: item.canonicalUrl,
      metadata: item.metadata,
      reviews,
    })).resolves.toEqual({
      kind: "article",
      stableKey: item.metadata.articleDraft.stableKey,
      version: 1,
    });
    expect(publishAcquired).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: "candidate-1",
      candidateRevision: 5,
      contentHash: item.contentHash,
      reviews: [
        expect.objectContaining({ locale: "es-ES" }),
        expect.objectContaining({ locale: "zh-CN" }),
      ],
    }));
  });

  it("rejects stale hashes, URLs and review revisions before writing content", async () => {
    const item = candidate();
    const publishAcquired = vi.fn();
    const publisher = new AcquiredArticlePublisher({
      publishAcquired,
      archiveAcquired: vi.fn(),
    } as unknown as AcquiredArticleRepository);
    const input = {
      candidateId: "candidate-1",
      candidateRevision: 5,
      contentHash: item.contentHash!,
      contentType: "article" as const,
      title: item.title,
      language: item.language,
      normalizedUrl: item.canonicalUrl,
      metadata: item.metadata,
      reviews,
    };

    await expect(publisher.publish({ ...input, contentHash: "a".repeat(64) })).rejects.toBeInstanceOf(ArticlePublicationConflictError);
    await expect(publisher.publish({ ...input, normalizedUrl: "https://news.example.test/other" })).rejects.toBeInstanceOf(ArticlePublicationConflictError);
    await expect(publisher.publish({ ...input, reviews: reviews.map((review) => ({ ...review, candidateRevision: 4 })) })).rejects.toBeInstanceOf(ArticlePublicationConflictError);
    expect(publishAcquired).not.toHaveBeenCalled();
  });
});
