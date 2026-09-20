import { randomUUID } from "node:crypto";

import { articleCandidateDraftSchema } from "../normalizers";
import type { ContentWorkflowRepository } from "../repositories";
import type { ArticleRevisionProvider } from "../providers/article-revision";
import { mergeArticleRevision } from "../providers/article-revision";

export async function reviseArticleCandidateAfterReview(
  repository: ContentWorkflowRepository,
  input: Readonly<{
    candidateId: string;
    revisionProvider: ArticleRevisionProvider;
    makeGenerationId?: () => string;
    now?: () => Date;
  }>,
) {
  const detail = await repository.getCandidateReview(input.candidateId);
  if (!detail) throw new Error("CANDIDATE_NOT_FOUND");
  const { candidate } = detail;
  if (candidate.contentType !== "article" || candidate.status !== "review_ready" || candidate.publicationStatus !== "draft") throw new Error("CANDIDATE_NOT_REVISIONABLE");
  const draft = articleCandidateDraftSchema.parse(candidate.metadata.articleDraft);
  const feedback = detail.reviews
    .filter((review) => review.candidateRevision === candidate.revision && review.status === "changes_requested")
    .map((review) => ({ dimension: review.dimension as "content-es-ES" | "teaching-zh-CN" | "structure", status: "changes_requested" as const, notes: review.notes }));
  if (feedback.length === 0) throw new Error("ARTICLE_REVISION_FEEDBACK_MISSING");
  const revised = mergeArticleRevision(draft, await input.revisionProvider.revise({
    candidateId: candidate.id,
    candidateRevision: candidate.revision,
    draft,
    feedback,
  }));
  if (revised.canonicalUrl !== candidate.normalizedUrl || revised.stableKey !== draft.stableKey || revised.locale !== draft.locale || revised.sourceName !== draft.sourceName || revised.licenseEvidence !== draft.licenseEvidence) {
    throw new Error("ARTICLE_REVISION_MUTATED_IMMUTABLE_FIELDS");
  }
  const now = (input.now ?? (() => new Date()))();
  const generationId = (input.makeGenerationId ?? randomUUID)();
  const updated = await repository.requestCandidateReprocessing({
    candidateId: candidate.id,
    expectedRevision: candidate.revision,
    generationId,
    metadata: { ...candidate.metadata, articleDraft: revised },
    contentHash: revised.contentHash,
    title: revised.title,
    updatedAt: now,
  });
  await repository.recordProcessingAttempt?.({
    id: randomUUID(),
    candidateId: candidate.id,
    jobType: "article-revision",
    jobId: `article-revision:${candidate.id}:${candidate.revision}`,
    generationId,
    expectedRevision: candidate.revision,
    status: "succeeded",
    estimatedCostMicros: 0,
    startedAt: now,
    completedAt: now,
    errorCode: null,
  });
  return updated;
}
