import { describe, expect, it, vi } from "vitest";

import { articleCandidateDraftSchema } from "@/src/modules/content-acquisition/normalizers";
import { articleReviewInputHash, type ArticleReviewInput, type ArticleReviewProvider } from "@/src/modules/content-acquisition/providers/article-review";
import { runArticleReview } from "@/src/modules/content-acquisition/application/run-article-review";
import type { CandidateReviewRecord } from "@/src/modules/content-acquisition/domain";
import type { ContentCandidateRecord, ContentWorkflowRepository } from "@/src/modules/content-acquisition/repositories";

const draft = articleCandidateDraftSchema.parse({
  stableKey: "article.acquired.fixture",
  locale: "es-ES",
  title: "Una noticia breve",
  summary: "Un resumen para la prueba.",
  author: null,
  canonicalUrl: "https://example.test/article",
  publicationDate: "2026-09-18",
  sourceName: "Fixture",
  sourceType: "licensed",
  license: "licensed",
  attribution: "Fixture",
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
  paragraphs: ["El texto de la prueba."],
  changeReason: "Fixture.",
});

const candidate: ContentCandidateRecord = {
  id: "candidate-1",
  sourceId: "source-1",
  externalItemId: "item-1",
  normalizedUrl: draft.canonicalUrl,
  title: draft.title,
  language: "es",
  metadata: { articleDraft: draft },
  publishedAt: null,
  contentHash: draft.contentHash,
  contentType: "article",
  rightsStatus: "verified",
  status: "review_ready",
  generationId: "generation-1",
  revision: 3,
  lastActivityAt: new Date("2026-09-18T00:00:00.000Z"),
  rejectedAt: null,
  publicationStatus: "draft",
  publicationRef: null,
  publishedCandidateRevision: null,
  publishedContentHash: null,
  publishedAtInternal: null,
  archivedAt: null,
};

function provider(dimension: ArticleReviewProvider["dimension"], result?: Partial<Awaited<ReturnType<ArticleReviewProvider["review"]>>>) {
  return {
    dimension,
    review: vi.fn(async (input: ArticleReviewInput) => ({
      decision: "approved" as const,
      notes: `${dimension} fixture`,
      modelVersion: `${dimension}-fixture-v1`,
      inputHash: articleReviewInputHash(input),
      ...result,
    })),
  } satisfies ArticleReviewProvider;
}

function repository(current: ContentCandidateRecord = candidate) {
  const saved: CandidateReviewRecord[] = [];
  const repo = {
    getCandidateReview: vi.fn(async () => ({ candidate: current, source: {} as never, artifacts: [], attempts: [], reviews: saved })),
    saveCandidateReview: vi.fn(async (input: Parameters<ContentWorkflowRepository["saveCandidateReview"]>[0]) => {
      const review = { id: input.id, candidateId: input.candidateId, dimension: input.dimension, status: input.status, reviewerReference: input.reviewerReference, candidateRevision: input.expectedRevision, notes: input.notes };
      saved.push(review);
      return review;
    }),
  } as unknown as ContentWorkflowRepository;
  return { repo, saved };
}

describe("runArticleReview", () => {
  it("runs independent language and teaching reviews, then writes deterministic structure approval", async () => {
    const content = provider("content-es-ES");
    const teaching = provider("teaching-zh-CN");
    const { repo, saved } = repository();

    const result = await runArticleReview(repo, { candidateId: candidate.id, contentProvider: content, teachingProvider: teaching, makeId: () => `review-${saved.length + 1}`, now: () => new Date("2026-09-18T01:00:00.000Z") });

    expect(result).toMatchObject({ status: "approved", candidateRevision: 3, reviewsWritten: 3 });
    expect(content.review).toHaveBeenCalledOnce();
    expect(teaching.review).toHaveBeenCalledOnce();
    expect(content.review.mock.calls[0]?.[0]).toEqual(teaching.review.mock.calls[0]?.[0]);
    expect(saved.map((review) => review.dimension)).toEqual(["content-es-ES", "teaching-zh-CN", "structure"]);
    expect(saved.every((review) => review.reviewerReference === "codex-ai-owner-authorized-review")).toBe(true);
  });

  it("fails closed when a provider returns a different frozen input hash", async () => {
    const content = provider("content-es-ES", { inputHash: "b".repeat(64) });
    const teaching = provider("teaching-zh-CN");
    const { repo, saved } = repository();

    await expect(runArticleReview(repo, { candidateId: candidate.id, contentProvider: content, teachingProvider: teaching })).resolves.toMatchObject({ status: "failed", reason: "ARTICLE_REVIEW_INPUT_HASH_MISMATCH", reviewsWritten: 0 });
    expect(saved).toHaveLength(0);
  });

  it("persists non-approval decisions without turning them into approvals", async () => {
    const content = provider("content-es-ES", { decision: "changes_requested", notes: "Needs a better source." });
    const teaching = provider("teaching-zh-CN");
    const { repo, saved } = repository();

    await expect(runArticleReview(repo, { candidateId: candidate.id, contentProvider: content, teachingProvider: teaching })).resolves.toMatchObject({ status: "changes_requested", reviewsWritten: 3 });
    expect(saved).toHaveLength(3);
    expect(saved.find((review) => review.dimension === "content-es-ES")?.status).toBe("changes_requested");
    expect(saved.filter((review) => review.status === "approved")).toHaveLength(2);
  });
});
