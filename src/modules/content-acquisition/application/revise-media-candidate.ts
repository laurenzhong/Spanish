import { randomUUID } from "node:crypto";

import { podcastCandidateDraftSchema, videoCandidateDraftSchema } from "../normalizers";
import type { MediaRevisionProvider } from "../providers/media-revision";
import { mergeMediaRevision } from "../providers/media-revision";
import type { ContentWorkflowRepository } from "../repositories";

export async function reviseMediaCandidateAfterReview(
  repository: ContentWorkflowRepository,
  input: Readonly<{ candidateId: string; revisionProvider: MediaRevisionProvider; now?: () => Date; makeGenerationId?: () => string }>,
) {
  const detail = await repository.getCandidateReview(input.candidateId);
  if (!detail) throw new Error("CANDIDATE_NOT_FOUND");
  const { candidate } = detail;
  if ((candidate.contentType !== "video" && candidate.contentType !== "podcast") || candidate.status !== "review_ready" || candidate.publicationStatus !== "draft") {
    throw new Error("CANDIDATE_NOT_REVISIONABLE");
  }
  const draftValue = candidate.metadata[candidate.contentType === "video" ? "videoDraft" : "podcastDraft"];
  const draft = candidate.contentType === "video" ? videoCandidateDraftSchema.parse(draftValue) : podcastCandidateDraftSchema.parse(draftValue);
  const feedback = detail.reviews
    .filter((review) => review.candidateRevision === candidate.revision && review.status === "changes_requested")
    .map((review) => ({ dimension: review.dimension as "content-es-ES" | "teaching-zh-CN" | "structure", notes: review.notes }));
  if (feedback.length === 0) throw new Error("MEDIA_REVISION_FEEDBACK_MISSING");
  const revised = mergeMediaRevision(draft, await input.revisionProvider.revise({
    candidateId: candidate.id,
    candidateRevision: candidate.revision,
    contentType: candidate.contentType,
    draft,
    feedback,
  }));
  if (revised.stableKey !== draft.stableKey || revised.canonicalUrl !== draft.canonicalUrl || revised.language !== draft.language || revised.license !== draft.license || revised.licenseEvidence !== draft.licenseEvidence || revised.copyrightStatus !== draft.copyrightStatus) {
    throw new Error("MEDIA_REVISION_MUTATED_IMMUTABLE_FIELDS");
  }
  const now = (input.now ?? (() => new Date()))();
  const generationId = (input.makeGenerationId ?? randomUUID)();
  const metadataKey = candidate.contentType === "video" ? "videoDraft" : "podcastDraft";
  const nextMetadata = { ...candidate.metadata, [metadataKey]: revised };
  // A revised video no longer has the asset proof for its new immutable hash;
  // it must be hosted and CDN-verified again before publication.
  if (candidate.contentType === "video") delete nextMetadata.bunnyVideoAsset;
  const updated = await repository.requestCandidateReprocessing({
    candidateId: candidate.id,
    expectedRevision: candidate.revision,
    generationId,
    title: revised.title,
    metadata: nextMetadata,
    contentHash: revised.contentHash,
    updatedAt: now,
  });
  await repository.recordProcessingAttempt?.({
    id: randomUUID(),
    candidateId: candidate.id,
    jobType: "media-revision",
    jobId: `media-revision:${candidate.id}:${candidate.revision}`,
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
