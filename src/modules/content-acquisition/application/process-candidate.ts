import {
  ContentAcquisitionConflictError,
  transitionCandidateState,
  type CandidateStateEvent,
} from "../domain";
import type { ContentAcquisitionRepository, ContentCandidateRecord } from "../repositories";

export async function processCandidate(
  repository: ContentAcquisitionRepository,
  input: Readonly<{
    candidateId: string;
    event: Exclude<CandidateStateEvent, Readonly<{ type: "retry" }>>;
    now?: () => Date;
  }>,
): Promise<ContentCandidateRecord> {
  const current = await repository.findCandidateById(input.candidateId);
  if (!current) throw new ContentAcquisitionConflictError("Content candidate was not found.");
  const next = transitionCandidateState(current, input.event);
  const updatedAt = input.now?.() ?? new Date();
  return repository.compareAndSwapCandidate({
    candidateId: current.id,
    expectedRevision: current.revision,
    expectedGenerationId: current.generationId,
    status: next.status,
    generationId: next.generationId,
    rejectedAt: next.status === "rejected" ? updatedAt : current.rejectedAt,
    updatedAt,
  });
}
