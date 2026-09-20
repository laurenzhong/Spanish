import { randomUUID } from "node:crypto";

import { articleCandidateDraftSchema } from "../normalizers";
import type { ContentCandidateRecord, ContentWorkflowRepository } from "../repositories";
import {
  articleReviewInputHash,
  articleReviewResultSchema,
  type ArticleReviewProvider,
  type ArticleReviewResult,
} from "../providers/article-review";

const REVIEWER_REFERENCE = "codex-ai-owner-authorized-review";
const DEFAULT_TIMEOUT_MS = 30_000;

export type ArticleReviewRunResult = Readonly<{
  status: "approved" | "changes_requested" | "rejected" | "failed";
  candidateId: string;
  candidateRevision: number;
  contentHash: string | null;
  reviewsWritten: number;
  reason: string | null;
  providerResults: Readonly<Record<string, ArticleReviewResult | null>>;
}>;

function timeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ARTICLE_REVIEW_TIMEOUT")), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function structureReview(input: Readonly<{
  candidate: ContentCandidateRecord;
  draft: unknown;
}>): ArticleReviewResult {
  try {
    const draft = articleCandidateDraftSchema.parse(input.draft);
    if (
      input.candidate.contentHash !== draft.contentHash
      || input.candidate.title !== draft.title
      || input.candidate.normalizedUrl !== draft.canonicalUrl
      || input.candidate.language !== "es"
      || input.candidate.rightsStatus !== "verified"
    ) {
      return {
        decision: "changes_requested",
        notes: "Candidate fields do not match the immutable article draft or verified rights state.",
        modelVersion: "deterministic-article-structure-v1",
        inputHash: "",
      };
    }
    return {
      decision: "approved",
      notes: "Article draft schema and immutable candidate fields are consistent.",
      modelVersion: "deterministic-article-structure-v1",
      inputHash: "",
    };
  } catch {
    return {
      decision: "changes_requested",
      notes: "Article draft does not satisfy the publication schema.",
      modelVersion: "deterministic-article-structure-v1",
      inputHash: "",
    };
  }
}

export async function runArticleReview(
  repository: ContentWorkflowRepository,
  input: Readonly<{
    candidateId: string;
    contentProvider: ArticleReviewProvider;
    teachingProvider: ArticleReviewProvider;
    timeoutMs?: number;
    makeId?: () => string;
    makeAttemptId?: () => string;
    makeGenerationId?: () => string;
    now?: () => Date;
  }>,
): Promise<ArticleReviewRunResult> {
  const detail = await repository.getCandidateReview(input.candidateId);
  if (!detail) {
    return { status: "failed", candidateId: input.candidateId, candidateRevision: 0, contentHash: null, reviewsWritten: 0, reason: "CANDIDATE_NOT_FOUND", providerResults: {} };
  }
  const { candidate } = detail;
  const draft = candidate.metadata.articleDraft;
  if (candidate.contentType !== "article" || candidate.status !== "review_ready" || candidate.publicationStatus !== "draft" || !candidate.contentHash || !draft || typeof draft !== "object") {
    return { status: "failed", candidateId: candidate.id, candidateRevision: candidate.revision, contentHash: candidate.contentHash, reviewsWritten: 0, reason: "CANDIDATE_NOT_REVIEWABLE", providerResults: {} };
  }

  let parsedDraft;
  try {
    parsedDraft = articleCandidateDraftSchema.parse(draft);
  } catch {
    return { status: "failed", candidateId: candidate.id, candidateRevision: candidate.revision, contentHash: candidate.contentHash, reviewsWritten: 0, reason: "INVALID_ARTICLE_DRAFT", providerResults: {} };
  }

  const reviewInput = {
    candidateId: candidate.id,
    candidateRevision: candidate.revision,
    contentHash: candidate.contentHash,
    title: candidate.title,
    summary: parsedDraft.summary,
    paragraphs: parsedDraft.paragraphs,
    draft: parsedDraft,
  } as const;
  const expectedInputHash = articleReviewInputHash(reviewInput);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const providerResults: Record<string, ArticleReviewResult | null> = {};
  const now = input.now ?? (() => new Date());
  const makeAttemptId = input.makeAttemptId ?? randomUUID;
  const makeGenerationId = input.makeGenerationId ?? randomUUID;
  const runProvider = async (dimension: "content-es-ES" | "teaching-zh-CN", provider: ArticleReviewProvider) => {
    const startedAt = now();
    const attemptId = makeAttemptId();
    const generationId = makeGenerationId();
    const jobType = `article-review-${dimension}`;
    const jobId = `article-review:${candidate.id}:${candidate.revision}:${dimension}`;
    try {
      const result = articleReviewResultSchema.parse(await timeout(provider.review(reviewInput), timeoutMs));
      await repository.recordProcessingAttempt?.({
        id: attemptId,
        candidateId: candidate.id,
        jobType,
        jobId,
        generationId,
        expectedRevision: candidate.revision,
        status: "succeeded",
        estimatedCostMicros: 0,
        startedAt,
        completedAt: now(),
        errorCode: null,
      });
      return result;
    } catch (error) {
      await repository.recordProcessingAttempt?.({
        id: attemptId,
        candidateId: candidate.id,
        jobType,
        jobId,
        generationId,
        expectedRevision: candidate.revision,
        status: "failed",
        estimatedCostMicros: 0,
        startedAt,
        completedAt: now(),
        errorCode: error instanceof Error ? error.message : "ARTICLE_REVIEW_FAILED",
      });
      throw error;
    }
  };
  const runProviderWithRetry = async (dimension: "content-es-ES" | "teaching-zh-CN", provider: ArticleReviewProvider) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await runProvider(dimension, provider);
      } catch (error) {
        lastError = error;
        const code = error instanceof Error ? error.message : "";
        if (!code.includes("PROVIDER_RESPONSE_INVALID") && !code.includes("PROVIDER_UNAVAILABLE") && !code.includes("PROVIDER_RATE_LIMITED")) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("ARTICLE_REVIEW_PROVIDER_FAILED");
  };
  try {
    const [contentRaw, teachingRaw] = await Promise.all([
      runProviderWithRetry("content-es-ES", input.contentProvider),
      runProviderWithRetry("teaching-zh-CN", input.teachingProvider),
    ]);
    const content = contentRaw;
    const teaching = teachingRaw;
    if (input.contentProvider.dimension !== "content-es-ES" || input.teachingProvider.dimension !== "teaching-zh-CN") {
      throw new Error("ARTICLE_REVIEW_PROVIDER_DIMENSION_MISMATCH");
    }
    providerResults["content-es-ES"] = content;
    providerResults["teaching-zh-CN"] = teaching;
    if (content.inputHash !== expectedInputHash || teaching.inputHash !== expectedInputHash) throw new Error("ARTICLE_REVIEW_INPUT_HASH_MISMATCH");
  } catch (error) {
    return { status: "failed", candidateId: candidate.id, candidateRevision: candidate.revision, contentHash: candidate.contentHash, reviewsWritten: 0, reason: error instanceof Error ? error.message : "ARTICLE_REVIEW_FAILED", providerResults };
  }

  const structure = { ...structureReview({ candidate, draft: parsedDraft }), inputHash: expectedInputHash };
  providerResults.structure = structure;
  const latest = await repository.getCandidateReview(candidate.id);
  if (!latest || latest.candidate.revision !== candidate.revision || latest.candidate.contentHash !== candidate.contentHash) {
    return { status: "failed", candidateId: candidate.id, candidateRevision: candidate.revision, contentHash: candidate.contentHash, reviewsWritten: 0, reason: "CANDIDATE_CHANGED_DURING_REVIEW", providerResults };
  }
  const makeId = input.makeId ?? randomUUID;
  const reviewedAt = now();
  let reviewsWritten = 0;
  for (const [dimension, result] of [["content-es-ES", providerResults["content-es-ES"]], ["teaching-zh-CN", providerResults["teaching-zh-CN"]], ["structure", structure]] as const) {
    if (!result) continue;
    await repository.saveCandidateReview({
      id: makeId(),
      candidateId: candidate.id,
      expectedRevision: candidate.revision,
      dimension,
      status: result.decision,
      reviewerReference: REVIEWER_REFERENCE,
      notes: result.notes,
      updatedAt: reviewedAt,
    });
    reviewsWritten += 1;
  }
  const decisions = [providerResults["content-es-ES"]?.decision, providerResults["teaching-zh-CN"]?.decision, structure.decision];
  const status = decisions.includes("rejected")
    ? "rejected"
    : decisions.every((decision) => decision === "approved")
      ? "approved"
      : "changes_requested";
  return { status, candidateId: candidate.id, candidateRevision: candidate.revision, contentHash: candidate.contentHash, reviewsWritten, reason: status === "approved" ? null : "ARTICLE_REVIEW_NOT_APPROVED", providerResults };
}
