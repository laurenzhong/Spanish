import { planCandidateCleanup, type CleanupInstruction } from "../domain";
import type { ContentCandidateRecord, ContentCleanupArtifactRecord } from "../repositories";

export type CleanupArtifact = ContentCleanupArtifactRecord;

export type ContentCleanupRepository = Readonly<{
  listCandidatesForCleanup(input: Readonly<{ limit: number }>): Promise<readonly ContentCandidateRecord[]>;
  listCandidateArtifactsForCleanup(candidateId: string): Promise<readonly CleanupArtifact[]>;
  deleteCandidateArtifact(artifactId: string): Promise<void>;
  purgeCandidate(candidateId: string): Promise<void>;
}>;

export type ContentCleanupRunnerInput = Readonly<{
  repository: ContentCleanupRepository;
  now: Date;
  largeArtifactThresholdBytes: number;
  limit: number;
  dryRun: boolean;
  recordFailure?: (input: Readonly<{ artifactId: string; error: string; occurredAt: Date }>) => Promise<void> | void;
}>;

export type ContentCleanupRunnerResult = Readonly<{
  candidates: number;
  attemptedArtifacts: number;
  deletedArtifacts: number;
  deferredArtifacts: number;
  purgedCandidates: number;
  planned: readonly CleanupInstruction[];
}>;

export async function runContentCleanup(
  input: ContentCleanupRunnerInput,
): Promise<ContentCleanupRunnerResult> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) throw new RangeError("limit must be between 1 and 500.");
  const candidates = await input.repository.listCandidatesForCleanup({ limit: input.limit });
  const planned: CleanupInstruction[] = [];
  let attemptedArtifacts = 0;
  let deletedArtifacts = 0;
  let deferredArtifacts = 0;
  let purgedCandidates = 0;

  for (const candidate of candidates) {
    const artifacts = await input.repository.listCandidateArtifactsForCleanup(candidate.id);
    const instructions = planCandidateCleanup({
      candidate,
      artifacts,
      now: input.now,
      largeArtifactThresholdBytes: input.largeArtifactThresholdBytes,
    });
    planned.push(...instructions);
    if (input.dryRun) continue;
    for (const instruction of instructions) {
      if (instruction.dueAt.getTime() > input.now.getTime()) continue;
      if (instruction.kind === "purge-candidate") {
        if (candidate.publicationStatus !== "draft") continue;
        await input.repository.purgeCandidate(instruction.targetId);
        purgedCandidates += 1;
        continue;
      }
      attemptedArtifacts += 1;
      try {
        await input.repository.deleteCandidateArtifact(instruction.targetId);
        deletedArtifacts += 1;
      } catch (error) {
        deferredArtifacts += 1;
        await input.recordFailure?.({
          artifactId: instruction.targetId,
          error: error instanceof Error ? error.message : "unknown storage error",
          occurredAt: input.now,
        });
      }
    }
  }
  return { candidates: candidates.length, attemptedArtifacts, deletedArtifacts, deferredArtifacts, purgedCandidates, planned };
}
