import { randomUUID } from "node:crypto";

import { validateSegmentTimeline } from "@/src/modules/media/domain";

import { calculatePodcastCandidateContentHash, podcastCandidateDraftSchema } from "../normalizers";
import type { ContentAcquisitionRepository, ContentCandidateRecord } from "../repositories";
import { processCandidate } from "./process-candidate";

export class PodcastCandidateValidationError extends Error {
  readonly code = "CONTENT_PROCESSING_FAILED" as const;

  constructor(message: string) {
    super(`Podcast candidate validation failed: ${message}`);
    this.name = "PodcastCandidateValidationError";
  }
}

const nextEvent = {
  discovered: "screen-approved",
  screened: "start-acquisition",
  acquiring: "start-processing",
  processing: "mark-review-ready",
} as const;

export async function preparePodcastCandidateForReview(
  repository: ContentAcquisitionRepository,
  candidateId: string,
  dependencies: Readonly<{ makeAttemptId?: () => string; now?: () => Date }> = {},
): Promise<ContentCandidateRecord> {
  const initial = await repository.findCandidateById(candidateId);
  if (!initial) throw new PodcastCandidateValidationError("candidate was not found.");
  if (initial.contentType !== "podcast" || initial.language !== "es" || initial.rightsStatus !== "verified") {
    throw new PodcastCandidateValidationError("candidate is not eligible for reviewed publication.");
  }
  let draft;
  try {
    draft = podcastCandidateDraftSchema.parse(initial.metadata.podcastDraft);
  } catch {
    throw new PodcastCandidateValidationError("immutable draft metadata is invalid.");
  }
  const transcriptMatches = draft.transcriptStatus === "unavailable"
    ? draft.transcriptUrl === null && draft.segments.length === 0
    : draft.segments.length > 0
      && draft.segments.every((segment) => segment.sourceKind === draft.transcriptStatus)
      && (draft.transcriptStatus === "asr" ? draft.transcriptUrl === null : draft.transcriptUrl !== null);
  if (!transcriptMatches) throw new PodcastCandidateValidationError("transcript state does not match the reviewed timeline.");
  if (draft.segments.length > 0) {
    try {
      validateSegmentTimeline(draft.segments, draft.durationMs);
    } catch {
      throw new PodcastCandidateValidationError("transcript timeline is invalid.");
    }
  }
  if (
    initial.contentHash !== draft.contentHash
    || draft.contentHash !== calculatePodcastCandidateContentHash(draft)
    || initial.normalizedUrl !== draft.canonicalUrl
    || initial.title !== draft.title
    || initial.externalItemId !== draft.episodeGuid
  ) {
    throw new PodcastCandidateValidationError("candidate fields do not match the immutable draft.");
  }
  const processingReview = initial.metadata.mediaProcessingReview;
  if (processingReview && typeof processingReview === "object" && "status" in processingReview && processingReview.status === "blocked") {
    throw new PodcastCandidateValidationError("media processing review is blocked by low-confidence transcript segments.");
  }
  if (initial.status === "review_ready") return initial;
  if (!(initial.status in nextEvent)) {
    throw new PodcastCandidateValidationError(`candidate cannot be prepared from ${initial.status}.`);
  }
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now();
  let current = initial;
  while (current.status !== "review_ready") {
    const type = nextEvent[current.status as keyof typeof nextEvent];
    if (!type) throw new PodcastCandidateValidationError(`candidate cannot continue from ${current.status}.`);
    current = await processCandidate(repository, {
      candidateId: current.id,
      event: { type, expectedRevision: current.revision, generationId: current.generationId },
      now,
    });
  }
  await repository.recordProcessingAttempt({
    id: (dependencies.makeAttemptId ?? randomUUID)(),
    candidateId: initial.id,
    jobType: "podcast-metadata-normalization",
    jobId: `podcast-metadata-normalization:${initial.id}`,
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
