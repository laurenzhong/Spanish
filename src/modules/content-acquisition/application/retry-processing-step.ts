import { ContentAcquisitionConflictError, transitionCandidateState } from "../domain";
import type { ContentAcquisitionRepository, ContentCandidateRecord } from "../repositories";

export async function retryProcessingStep(
  repository: ContentAcquisitionRepository,
  input: Readonly<{
    candidateId: string;
    expectedRevision: number;
    generationId: string;
    now?: () => Date;
  }>,
): Promise<ContentCandidateRecord> {
  const current = await repository.findCandidateById(input.candidateId);
  if (!current) throw new ContentAcquisitionConflictError("Content candidate was not found.");
  const next = transitionCandidateState(current, {
    type: "retry",
    expectedRevision: input.expectedRevision,
    generationId: input.generationId,
  });
  return repository.compareAndSwapCandidate({
    candidateId: current.id,
    expectedRevision: current.revision,
    expectedGenerationId: current.generationId,
    status: next.status,
    generationId: next.generationId,
    updatedAt: input.now?.() ?? new Date(),
  });
}
