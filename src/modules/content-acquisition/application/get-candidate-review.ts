import { assertContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";

import type { CandidatePublisherRegistry } from "../publishers";
import type { ContentWorkflowRepository } from "../repositories";

export async function getCandidateReview(
  repository: ContentWorkflowRepository,
  input: Readonly<{ ownerUserId: string; candidateId: string; publishers?: CandidatePublisherRegistry }>,
) {
  assertContentWorkflowOwner(input.ownerUserId);
  const detail = await repository.getCandidateReview(input.candidateId);
  if (!detail) return null;
  return {
    ...detail,
    publisherAvailable: input.publishers?.has(detail.candidate.contentType) ?? false,
  };
}
