import { randomUUID } from "node:crypto";

import { validateSegmentTimeline } from "@/src/modules/media/domain";

import { calculateLegacyVideoCandidateContentHash, calculateVideoCandidateContentHash, videoCandidateDraftSchema } from "../normalizers";
import type { ContentAcquisitionRepository, ContentCandidateRecord } from "../repositories";
import { processCandidate } from "./process-candidate";

export class VideoCandidateValidationError extends Error {
  readonly code = "CONTENT_PROCESSING_FAILED" as const;

  constructor(message: string) {
    super(`Video candidate validation failed: ${message}`);
    this.name = "VideoCandidateValidationError";
  }
}

const nextEvent = {
  discovered: "screen-approved",
  screened: "start-acquisition",
  acquiring: "start-processing",
  processing: "mark-review-ready",
} as const;

export async function prepareVideoCandidateForReview(
  repository: ContentAcquisitionRepository,
  candidateId: string,
  dependencies: Readonly<{ makeAttemptId?: () => string; now?: () => Date }> = {},
): Promise<ContentCandidateRecord> {
  const initial = await repository.findCandidateById(candidateId);
  if (!initial) throw new VideoCandidateValidationError("candidate was not found.");
  if (initial.contentType !== "video" || initial.language !== "es" || initial.rightsStatus !== "verified") {
    throw new VideoCandidateValidationError("candidate is not eligible for reviewed publication.");
  }
  let draft;
  try {
    draft = videoCandidateDraftSchema.parse(initial.metadata.videoDraft);
  } catch {
    throw new VideoCandidateValidationError("immutable draft metadata is invalid.");
  }
  const captionStateMatches = draft.captionStatus === "unavailable"
    ? draft.segments.length === 0
    : draft.segments.length > 0 && draft.segments.every((segment) => segment.sourceKind === draft.captionStatus);
  if (!captionStateMatches) throw new VideoCandidateValidationError("caption state does not match the reviewed timeline.");
  if (draft.segments.length > 0) {
    try {
      validateSegmentTimeline(draft.segments, draft.durationMs);
    } catch {
      throw new VideoCandidateValidationError("caption timeline is invalid.");
    }
  }
  const legacyArtworkOmitted = !Object.prototype.hasOwnProperty.call(initial.metadata.videoDraft, "artwork");
  const hashMatches = draft.contentHash === calculateVideoCandidateContentHash(draft)
    || (legacyArtworkOmitted && draft.contentHash === calculateLegacyVideoCandidateContentHash(draft));
  if (
    initial.contentHash !== draft.contentHash
    || !hashMatches
    || initial.normalizedUrl !== draft.canonicalUrl
    || initial.title !== draft.title
    || initial.externalItemId !== draft.platformVideoId
  ) {
    throw new VideoCandidateValidationError("candidate fields do not match the immutable draft.");
  }
  const processingReview = initial.metadata.mediaProcessingReview;
  if (processingReview && typeof processingReview === "object" && "status" in processingReview && processingReview.status === "blocked") {
    throw new VideoCandidateValidationError("media processing review is blocked by low-confidence transcript segments.");
  }
  if (initial.status === "review_ready") return initial;
  if (!(initial.status in nextEvent)) {
    throw new VideoCandidateValidationError(`candidate cannot be prepared from ${initial.status}.`);
  }

  const now = dependencies.now ?? (() => new Date());
  const startedAt = now();
  let current = initial;
  while (current.status !== "review_ready") {
    const type = nextEvent[current.status as keyof typeof nextEvent];
    if (!type) throw new VideoCandidateValidationError(`candidate cannot continue from ${current.status}.`);
    current = await processCandidate(repository, {
      candidateId: current.id,
      event: { type, expectedRevision: current.revision, generationId: current.generationId },
      now,
    });
  }
  await repository.recordProcessingAttempt({
    id: (dependencies.makeAttemptId ?? randomUUID)(),
    candidateId: initial.id,
    jobType: "youtube-metadata-normalization",
    jobId: `youtube-metadata-normalization:${initial.id}`,
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
