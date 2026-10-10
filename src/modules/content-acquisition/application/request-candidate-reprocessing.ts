import { randomUUID } from "node:crypto";

import { assertContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";

import { OWNER_AUTHORIZED_REVIEWER_REFERENCE } from "../domain";
import type { ContentWorkflowRepository } from "../repositories";
import { reprocessCandidateSchema } from "../schemas";

export async function requestCandidateReprocessing(
  repository: ContentWorkflowRepository,
  input: Readonly<{ ownerUserId: string; candidateId: string; expectedRevision: number; notes: string }>,
  options: Readonly<{ makeGenerationId?: () => string; makeReviewId?: () => string; now?: () => Date }> = {},
) {
  assertContentWorkflowOwner(input.ownerUserId);
  const parsed = reprocessCandidateSchema.parse({ expectedRevision: input.expectedRevision, notes: input.notes });
  const now = (options.now ?? (() => new Date()))();
  await repository.saveCandidateReview({
    id: (options.makeReviewId ?? randomUUID)(),
    candidateId: input.candidateId,
    expectedRevision: parsed.expectedRevision,
    dimension: "structure",
    status: "changes_requested",
    reviewerReference: OWNER_AUTHORIZED_REVIEWER_REFERENCE,
    notes: parsed.notes,
    updatedAt: now,
  });
  return repository.requestCandidateReprocessing({
    candidateId: input.candidateId,
    expectedRevision: parsed.expectedRevision,
    generationId: (options.makeGenerationId ?? randomUUID)(),
    updatedAt: now,
  });
}
