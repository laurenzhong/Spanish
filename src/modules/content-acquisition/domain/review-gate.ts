import type { ContentCandidateType } from "../schemas";

export const candidateReviewDimensions = [
  "rights",
  "content-es-ES",
  "teaching-zh-CN",
  "structure",
  "owner-release",
] as const;
export type CandidateReviewDimension = (typeof candidateReviewDimensions)[number];

export const candidateReviewStatuses = ["pending", "approved", "changes_requested", "rejected"] as const;
export type CandidateReviewStatus = (typeof candidateReviewStatuses)[number];
export type CandidatePublicationStatus = "draft" | "published" | "archived";

export type CandidateReviewRecord = Readonly<{
  id: string;
  candidateId: string;
  dimension: CandidateReviewDimension;
  status: CandidateReviewStatus;
  reviewerReference: string | null;
  candidateRevision: number;
  notes: string | null;
}>;

export type PublishableCandidate = Readonly<{
  id: string;
  contentType: ContentCandidateType;
  status: string;
  rightsStatus: string;
  revision: number;
  contentHash: string | null;
  publicationStatus: CandidatePublicationStatus;
}>;

export class ContentReviewIncompleteError extends Error {
  readonly code = "CONTENT_REVIEW_INCOMPLETE" as const;
  constructor(message = "The current candidate revision has not passed every publication gate.") {
    super(message);
    this.name = "ContentReviewIncompleteError";
  }
}

export class ContentPublicationConflictError extends Error {
  readonly code = "CONTENT_PUBLICATION_CONFLICT" as const;
  constructor(message = "The candidate changed before publication could be committed.") {
    super(message);
    this.name = "ContentPublicationConflictError";
  }
}

export class ContentPublisherNotAvailableError extends Error {
  readonly code = "CONTENT_PUBLISHER_NOT_AVAILABLE" as const;
  constructor(contentType: ContentCandidateType) {
    super(`No production publisher is registered for ${contentType} candidates.`);
    this.name = "ContentPublisherNotAvailableError";
  }
}

export function assertCandidatePublishable(
  candidate: PublishableCandidate,
  reviews: readonly CandidateReviewRecord[],
  expected: Readonly<{ expectedRevision: number; expectedContentHash: string }>,
): void {
  if (
    candidate.revision !== expected.expectedRevision
    || candidate.contentHash !== expected.expectedContentHash
    || candidate.publicationStatus !== "draft"
  ) {
    throw new ContentPublicationConflictError();
  }
  if (candidate.status !== "review_ready" || candidate.rightsStatus !== "verified") {
    throw new ContentReviewIncompleteError("The candidate is not review-ready or its rights are not verified.");
  }
  if (!/^[a-f0-9]{64}$/u.test(candidate.contentHash)) {
    throw new ContentReviewIncompleteError("The candidate does not have a valid immutable content hash.");
  }
  for (const dimension of ["content-es-ES", "teaching-zh-CN", "structure"] as const) {
    const approved = reviews.some((review) =>
      review.dimension === dimension
      && review.status === "approved"
      && review.candidateRevision === candidate.revision
      && review.reviewerReference === "codex-ai-owner-authorized-review"
    );
    if (!approved) throw new ContentReviewIncompleteError(`Missing ${dimension} approval for the current revision.`);
  }
}
