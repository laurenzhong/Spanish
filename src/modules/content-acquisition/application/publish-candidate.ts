import { randomUUID } from "node:crypto";

import { assertContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";

import { ContentPublicationConflictError, assertCandidatePublishable, ownerAuthorizedReviewerReference } from "../domain";
import type { CandidatePublisherRegistry } from "../publishers";
import type { ContentWorkflowRepository } from "../repositories";
import { publishCandidateSchema } from "../schemas";

export async function publishCandidate(
  repository: ContentWorkflowRepository,
  publishers: CandidatePublisherRegistry,
  input: Readonly<{ ownerUserId: string; candidateId: string; expectedRevision: number; expectedContentHash: string }>,
  options: Readonly<{ makeReviewId?: () => string; now?: () => Date }> = {},
) {
  assertContentWorkflowOwner(input.ownerUserId);
  const expected = publishCandidateSchema.parse({ expectedRevision: input.expectedRevision, expectedContentHash: input.expectedContentHash });
  const detail = await repository.getCandidateReview(input.candidateId);
  if (!detail) throw new ContentPublicationConflictError("The candidate no longer exists.");
  assertCandidatePublishable(detail.candidate, detail.reviews, expected);
  const publisher = publishers.require(detail.candidate.contentType);
  const publicationRef = await publisher.publish({
    candidateId: detail.candidate.id,
    candidateRevision: detail.candidate.revision,
    contentHash: expected.expectedContentHash,
    contentType: detail.candidate.contentType,
    title: detail.candidate.title,
    language: detail.candidate.language,
    normalizedUrl: detail.candidate.normalizedUrl,
    metadata: detail.candidate.metadata,
    reviews: detail.reviews,
  });
  let candidate;
  try {
    candidate = await repository.markCandidatePublished({
      reviewId: (options.makeReviewId ?? randomUUID)(),
      candidateId: input.candidateId,
      expectedRevision: expected.expectedRevision,
      expectedContentHash: expected.expectedContentHash,
      publicationRef,
      reviewerReference: ownerAuthorizedReviewerReference(),
      publishedAt: (options.now ?? (() => new Date()))(),
    });
  } catch (error) {
    // A publisher must create an immutable version atomically. If the workflow
    // CAS subsequently fails, remove that version from its public projection;
    // its internal audit record may remain for reconciliation.
    await publisher.archive({ publication: publicationRef, candidateId: detail.candidate.id }).catch(() => undefined);
    throw error;
  }
  return { candidate, publicationRef };
}
