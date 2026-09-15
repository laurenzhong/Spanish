import { planCandidateCleanup, type CandidateRetentionInput, type CleanupInstruction } from "../domain";

export type ArtifactCleanupExecutor = Readonly<{
  deleteArtifact: (artifactId: string) => Promise<"deleted" | "delete-pending" | "failed">;
  purgeCandidate?: (candidateId: string) => Promise<"deleted" | "delete-pending" | "failed">;
}>;

export type CandidateCleanupResult = Readonly<{
  instructions: readonly CleanupInstruction[];
  outcomes: readonly Readonly<{ instruction: CleanupInstruction; status: "deleted" | "delete-pending" | "failed"; errorCode?: string }>[];
}>;

/** Execute retention instructions without claiming a deletion succeeded when the storage call failed. */
export async function cleanupCandidateArtifacts(input: Readonly<{
  retention: CandidateRetentionInput;
  executor: ArtifactCleanupExecutor;
}>): Promise<CandidateCleanupResult> {
  const instructions = planCandidateCleanup(input.retention);
  const outcomes: Array<{ instruction: CleanupInstruction; status: "deleted" | "delete-pending" | "failed"; errorCode?: string }> = [];
  for (const instruction of instructions) {
    try {
      const status = instruction.kind === "delete-artifact"
        ? await input.executor.deleteArtifact(instruction.targetId)
        : input.executor.purgeCandidate
          ? await input.executor.purgeCandidate(instruction.targetId)
          : "delete-pending";
      outcomes.push({ instruction, status });
    } catch (error) {
      outcomes.push({ instruction, status: "failed", errorCode: error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "cleanup-failed" });
    }
  }
  return { instructions, outcomes };
}
