export type CandidateArtifactCleanupInstruction = Readonly<{
  artifactId: string;
  dueAt: Date;
}>;

export type CandidateArtifactCleanupStore = Readonly<{
  deleteArtifact(artifactId: string): Promise<void>;
  recordDeletionFailure?(input: Readonly<{ artifactId: string; error: string; occurredAt: Date }>): Promise<void>;
}>;

export type CandidateArtifactCleanupResult = Readonly<{
  attempted: number;
  deleted: readonly string[];
  deferred: readonly string[];
}>;

/** Executes only due cleanup work and keeps failed deletes retryable. */
export async function cleanupCandidateArtifacts(
  instructions: readonly CandidateArtifactCleanupInstruction[],
  store: CandidateArtifactCleanupStore,
  now: Date = new Date(),
): Promise<CandidateArtifactCleanupResult> {
  const due = [...new Map(instructions.map((instruction) => [instruction.artifactId, instruction])).values()]
    .filter((instruction) => instruction.dueAt.getTime() <= now.getTime());
  const deleted: string[] = [];
  const deferred: string[] = [];
  for (const instruction of due) {
    try {
      await store.deleteArtifact(instruction.artifactId);
      deleted.push(instruction.artifactId);
    } catch (error) {
      deferred.push(instruction.artifactId);
      await store.recordDeletionFailure?.({
        artifactId: instruction.artifactId,
        error: error instanceof Error ? error.message : "unknown storage error",
        occurredAt: now,
      });
    }
  }
  return { attempted: due.length, deleted, deferred };
}
