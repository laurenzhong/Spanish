import { randomUUID } from "node:crypto";

import { ArticleCandidateValidationError, articleCandidateDraftSchema } from "../normalizers";
import type { ContentAcquisitionRepository, ContentCandidateRecord } from "../repositories";
import { processCandidate } from "./process-candidate";

const nextEvent = {
  discovered: "screen-approved",
  screened: "start-acquisition",
  acquiring: "start-processing",
  processing: "mark-review-ready",
} as const;

export async function prepareArticleCandidateForReview(
  repository: ContentAcquisitionRepository,
  candidateId: string,
  dependencies: Readonly<{ makeAttemptId?: () => string; now?: () => Date }> = {},
): Promise<ContentCandidateRecord> {
  const initial = await repository.findCandidateById(candidateId);
  if (!initial) throw new ArticleCandidateValidationError("Article candidate was not found.");
  if (initial.contentType !== "article" || initial.language !== "es" || initial.rightsStatus !== "verified") {
    throw new ArticleCandidateValidationError("Article candidate is not eligible for reviewed publication.");
  }
  let draft;
  try {
    draft = articleCandidateDraftSchema.parse(initial.metadata.articleDraft);
  } catch {
    throw new ArticleCandidateValidationError("Article candidate draft metadata is invalid.");
  }
  if (
    initial.contentHash !== draft.contentHash
    || initial.normalizedUrl !== draft.canonicalUrl
    || initial.title !== draft.title
  ) {
    throw new ArticleCandidateValidationError("Article candidate fields do not match the immutable draft.");
  }
  if (initial.status === "review_ready") return initial;
  if (!(initial.status in nextEvent)) {
    throw new ArticleCandidateValidationError(`Article candidate cannot be prepared from ${initial.status}.`);
  }

  const now = dependencies.now ?? (() => new Date());
  const startedAt = now();
  let current = initial;
  while (current.status !== "review_ready") {
    const type = nextEvent[current.status as keyof typeof nextEvent];
    if (!type) throw new ArticleCandidateValidationError(`Article candidate cannot continue from ${current.status}.`);
    current = await processCandidate(repository, {
      candidateId: current.id,
      event: {
        type,
        expectedRevision: current.revision,
        generationId: current.generationId,
      },
      now,
    });
  }
  await repository.recordProcessingAttempt({
    id: (dependencies.makeAttemptId ?? randomUUID)(),
    candidateId: initial.id,
    jobType: "article-normalization",
    jobId: `article-normalization:${initial.id}`,
    generationId: initial.generationId,
    expectedRevision: initial.revision,
    status: "succeeded",
    estimatedCostMicros: 0,
    startedAt,
    completedAt: now(),
    errorCode: null,
  });
  return current;
}
