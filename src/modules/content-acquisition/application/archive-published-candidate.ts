import { assertContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";

import { ContentPublicationConflictError } from "../domain";
import type { CandidatePublisherRegistry } from "../publishers";
import type { ContentWorkflowRepository } from "../repositories";
import { archiveCandidateSchema } from "../schemas";

export async function archivePublishedCandidate(
  repository: ContentWorkflowRepository,
  publishers: CandidatePublisherRegistry,
  input: Readonly<{ ownerUserId: string; candidateId: string; expectedRevision: number }>,
  options: Readonly<{ now?: () => Date }> = {},
) {
  assertContentWorkflowOwner(input.ownerUserId);
  const expected = archiveCandidateSchema.parse({ expectedRevision: input.expectedRevision });
  const candidate = await repository.findCandidateById(input.candidateId);
  if (!candidate || candidate.publicationStatus !== "published" || !candidate.publicationRef || candidate.revision !== expected.expectedRevision) {
    throw new ContentPublicationConflictError("The published candidate changed before archival.");
  }
  const publisher = publishers.require(candidate.contentType);
  await publisher.archive({ publication: candidate.publicationRef, candidateId: candidate.id });
  return repository.markCandidateArchived({
    candidateId: candidate.id,
    expectedRevision: expected.expectedRevision,
    publicationRef: candidate.publicationRef,
    archivedAt: (options.now ?? (() => new Date()))(),
  });
}
