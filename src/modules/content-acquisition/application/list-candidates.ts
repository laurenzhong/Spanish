import { assertContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";

import type { CandidateStatus } from "../domain";
import type { ContentWorkflowRepository } from "../repositories";
import type { ContentCandidateType } from "../schemas";

export async function listCandidates(
  repository: ContentWorkflowRepository,
  input: Readonly<{ ownerUserId: string; status?: CandidateStatus; contentType?: ContentCandidateType; limit?: number }>,
) {
  assertContentWorkflowOwner(input.ownerUserId);
  return repository.listCandidates(input);
}

export async function listAcquisitionSources(repository: ContentWorkflowRepository, ownerUserId: string) {
  assertContentWorkflowOwner(ownerUserId);
  return repository.listSources();
}

export async function listAcquisitionRuns(
  repository: ContentWorkflowRepository,
  input: Readonly<{ ownerUserId: string; sourceId?: string; limit?: number }>,
) {
  assertContentWorkflowOwner(input.ownerUserId);
  return repository.listRuns(input);
}

export async function getAcquisitionRun(repository: ContentWorkflowRepository, ownerUserId: string, runId: string) {
  assertContentWorkflowOwner(ownerUserId);
  return repository.findRunById(runId);
}
