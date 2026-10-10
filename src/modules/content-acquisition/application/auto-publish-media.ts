import { randomUUID } from "node:crypto";

import { assertCandidatePublishable, ContentPublicationConflictError, ownerAuthorizedReviewerReference } from "../domain";
import type { ContentWorkflowRepository } from "../repositories";
import type { CandidatePublisherRegistry } from "../publishers";

export type AutoPublishMediaResult = Readonly<{
  status: "published" | "skipped" | "failed";
  candidateId: string;
  publicationRef: Readonly<{ kind: "media"; stableKey: string; version: number }> | null;
  reason: string | null;
}>;

export async function autoPublishMediaCandidate(
  repository: ContentWorkflowRepository,
  publishers: CandidatePublisherRegistry,
  input: Readonly<{ candidateId: string; actor: string; runId?: string; makeReviewId?: () => string; now?: () => Date; requireBilingualSubtitles?: boolean }>,
): Promise<AutoPublishMediaResult> {
  const skip = (reason: string): AutoPublishMediaResult => ({ status: "skipped", candidateId: input.candidateId, publicationRef: null, reason });
  const detail = await repository.getCandidateReview(input.candidateId);
  if (!detail) return skip("CANDIDATE_NOT_FOUND");
  const { candidate } = detail;
  if ((candidate.contentType !== "video" && candidate.contentType !== "podcast") || !candidate.contentHash) return skip("CANDIDATE_NOT_MEDIA");
  // Hosting is an explicit stage for YouTube videos. Do not invoke the publisher
  // until the downloaded, validated Bunny MP4 has been attached to this revision.
  if (candidate.contentType === "video" && (!candidate.metadata.bunnyVideoAsset || typeof candidate.metadata.bunnyVideoAsset !== "object")) {
    return skip("MEDIA_VIDEO_HOSTING_REQUIRED");
  }
  if (candidate.publicationStatus === "published" && candidate.publicationRef?.kind === "media" && candidate.publishedCandidateRevision === candidate.revision && candidate.publishedContentHash === candidate.contentHash) {
    return { status: "published", candidateId: candidate.id, publicationRef: { kind: "media", stableKey: candidate.publicationRef.stableKey, version: candidate.publicationRef.version }, reason: null };
  }
  try {
    assertCandidatePublishable(candidate, detail.reviews, { expectedRevision: candidate.revision, expectedContentHash: candidate.contentHash });
  } catch (error) {
    return skip(error instanceof Error ? error.message : "CANDIDATE_NOT_PUBLISHABLE");
  }
  const publisher = publishers.require(candidate.contentType);
  const publicationRef = await publisher.publish({
    candidateId: candidate.id,
    candidateRevision: candidate.revision,
    contentHash: candidate.contentHash,
    contentType: candidate.contentType,
    title: candidate.title,
    language: candidate.language,
    normalizedUrl: candidate.normalizedUrl,
    metadata: candidate.metadata,
    reviews: detail.reviews,
    requireBilingualSubtitles: input.requireBilingualSubtitles,
  });
  if (publicationRef.kind !== "media") {
    await publisher.archive({ publication: publicationRef, candidateId: candidate.id }).catch(() => undefined);
    return { status: "failed", candidateId: candidate.id, publicationRef: null, reason: "MEDIA_PUBLISHER_RETURNED_NON_MEDIA" };
  }
  const mediaPublicationRef = { kind: "media" as const, stableKey: publicationRef.stableKey, version: publicationRef.version };
  try {
    await repository.markCandidatePublished({
      reviewId: (input.makeReviewId ?? randomUUID)(),
      candidateId: candidate.id,
      expectedRevision: candidate.revision,
      expectedContentHash: candidate.contentHash,
      publicationRef: mediaPublicationRef,
      reviewerReference: ownerAuthorizedReviewerReference({ actor: input.actor, runId: input.runId }),
      publishedAt: (input.now ?? (() => new Date()))(),
    });
  } catch (error) {
    await publisher.archive({ publication: mediaPublicationRef, candidateId: candidate.id }).catch(() => undefined);
    return { status: "failed", candidateId: candidate.id, publicationRef: null, reason: error instanceof ContentPublicationConflictError ? error.message : error instanceof Error ? error.message : "MEDIA_PUBLICATION_COMMIT_FAILED" };
  }
  return { status: "published", candidateId: candidate.id, publicationRef: mediaPublicationRef, reason: null };
}
