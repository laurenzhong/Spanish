import { archiveAcquiredVideo, publishAcquiredVideo, validateSegmentTimeline } from "@/src/modules/media";
import type { AcquiredMediaReview, AcquiredVideoRepository } from "@/src/modules/media/repositories";

import { calculateVideoCandidateContentHash, videoCandidateDraftSchema } from "../normalizers";
import type { CandidatePublisher, CandidatePublisherInput } from "./candidate-publisher";

export class VideoPublicationConflictError extends Error {
  readonly code = "CONTENT_PUBLICATION_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "VideoPublicationConflictError";
  }
}

function requiredReview(
  input: CandidatePublisherInput,
  dimension: "content-es-ES" | "teaching-zh-CN",
  locale: AcquiredMediaReview["locale"],
  reviewedAt: Date,
): AcquiredMediaReview {
  const review = input.reviews.find((candidate) =>
    candidate.dimension === dimension
    && candidate.status === "approved"
    && candidate.candidateRevision === input.candidateRevision
    && candidate.reviewerReference === "codex-ai-owner-authorized-review",
  );
  if (!review) throw new VideoPublicationConflictError(`The ${dimension} review is missing or stale.`);
  return { locale, reviewerReference: "codex-ai-owner-authorized-review", notes: review.notes, reviewedAt };
}

export class AcquiredVideoPublisher implements CandidatePublisher {
  readonly contentType = "video" as const;

  constructor(
    private readonly repository: AcquiredVideoRepository,
    private readonly dependencies: Readonly<{ now?: () => Date }> = {},
  ) {}

  async publish(input: CandidatePublisherInput) {
    let draft;
    try {
      draft = videoCandidateDraftSchema.parse(input.metadata.videoDraft);
      if (draft.segments.length > 0) validateSegmentTimeline(draft.segments, draft.durationMs);
    } catch {
      throw new VideoPublicationConflictError("The reviewed video draft or segment timeline is invalid.");
    }
    const processingReview = input.metadata.mediaProcessingReview;
    if (processingReview && typeof processingReview === "object" && "status" in processingReview && processingReview.status === "blocked") {
      throw new VideoPublicationConflictError("The media processing review is blocked by low-confidence transcript segments.");
    }
    const captionMatches = draft.captionStatus === "unavailable"
      ? draft.segments.length === 0
      : draft.segments.length > 0 && draft.segments.every((segment) => segment.sourceKind === draft.captionStatus);
    if (
      input.contentType !== "video"
      || input.contentHash !== draft.contentHash
      || draft.contentHash !== calculateVideoCandidateContentHash(draft)
      || input.normalizedUrl !== draft.canonicalUrl
      || input.title !== draft.title
      || input.language !== "es"
      || draft.canonicalUrl !== `https://www.youtube.com/watch?v=${draft.platformVideoId}`
      || draft.embedUrl !== `https://www.youtube-nocookie.com/embed/${draft.platformVideoId}?enablejsapi=1`
      || !captionMatches
    ) {
      throw new VideoPublicationConflictError("The video candidate no longer matches its reviewed draft.");
    }
    const reviewedAt = (this.dependencies.now ?? (() => new Date()))();
    const reviews = [
      requiredReview(input, "content-es-ES", "es-ES", reviewedAt),
      requiredReview(input, "teaching-zh-CN", "zh-CN", reviewedAt),
    ] as const;
    return publishAcquiredVideo(this.repository, {
      candidateId: input.candidateId,
      candidateRevision: input.candidateRevision,
      contentHash: input.contentHash,
      draft,
      reviews,
      publishedAt: reviewedAt,
    });
  }

  async archive(input: Readonly<{ publication: { kind: "article" | "media"; stableKey: string; version: number }; candidateId: string }>) {
    if (input.publication.kind !== "media") {
      throw new VideoPublicationConflictError("A video publisher cannot archive an article publication.");
    }
    return archiveAcquiredVideo(this.repository, {
      candidateId: input.candidateId,
      publication: { ...input.publication, kind: "media" },
      archivedAt: (this.dependencies.now ?? (() => new Date()))(),
    });
  }
}
