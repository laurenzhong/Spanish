import { assertContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";
import type { DraftMediaSegment } from "../domain";
import type { MediaTranscriptBackfillRepository, MediaTranscriptBackfillReviewDimension } from "../repositories";

export async function reviewPublishedMediaTranscript(
  repository: MediaTranscriptBackfillRepository,
  input: Readonly<{ ownerUserId: string; backfillId: string; dimension: MediaTranscriptBackfillReviewDimension; status: "approved" | "changes_requested" | "rejected"; notes: string | null }>,
  now = new Date(),
) {
  assertContentWorkflowOwner(input.ownerUserId);
  return repository.reviewTranscriptBackfill({
    backfillId: input.backfillId,
    dimension: input.dimension,
    status: input.status,
    reviewerReference: "codex-ai-owner-authorized-review",
    notes: input.notes,
    reviewedAt: now,
  });
}

export async function publishPublishedMediaTranscript(
  repository: MediaTranscriptBackfillRepository,
  input: Readonly<{ ownerUserId: string; backfillId: string }>,
  now = new Date(),
) {
  assertContentWorkflowOwner(input.ownerUserId);
  return repository.publishTranscriptBackfill({
    backfillId: input.backfillId,
    expectedReviews: ["content-es-ES", "teaching-zh-CN", "structure"],
    publishedAt: now,
  });
}

export async function saveTranslatedMediaTranscript(
  repository: MediaTranscriptBackfillRepository,
  input: Readonly<{ ownerUserId: string; backfillId: string; segments: readonly DraftMediaSegment[]; translationFailedCount: number }>,
  now = new Date(),
) {
  assertContentWorkflowOwner(input.ownerUserId);
  if (!repository.updateTranscriptBackfillTranslations) throw new Error("MEDIA_TRANSCRIPT_TRANSLATION_UPDATE_UNAVAILABLE");
  return repository.updateTranscriptBackfillTranslations({
    backfillId: input.backfillId,
    segments: input.segments,
    translationFailedCount: input.translationFailedCount,
    updatedAt: now,
  });
}
