import { randomUUID } from "node:crypto";

import { assertContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";

import { OWNER_AUTHORIZED_REVIEWER_REFERENCE } from "../domain";
import type { ContentWorkflowRepository } from "../repositories";
import { submitCandidateReviewSchema, type SubmitCandidateReviewInput } from "../schemas";

const REVIEWER_REFERENCE = OWNER_AUTHORIZED_REVIEWER_REFERENCE;

export async function submitCandidateReview(
  repository: ContentWorkflowRepository,
  input: Readonly<{ ownerUserId: string; candidateId: string; review: SubmitCandidateReviewInput }>,
  options: Readonly<{ makeId?: () => string; now?: () => Date }> = {},
) {
  assertContentWorkflowOwner(input.ownerUserId);
  const review = submitCandidateReviewSchema.parse(input.review);
  return repository.saveCandidateReview({
    id: (options.makeId ?? randomUUID)(),
    candidateId: input.candidateId,
    expectedRevision: review.expectedRevision,
    dimension: review.dimension,
    status: review.status,
    reviewerReference: REVIEWER_REFERENCE,
    notes: review.notes,
    updatedAt: (options.now ?? (() => new Date()))(),
  });
}
