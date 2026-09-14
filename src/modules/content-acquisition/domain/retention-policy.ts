import type { CandidateStatus } from "./acquisition-state";

const dayMs = 24 * 60 * 60 * 1_000;
const unpublishedRetentionMs = 30 * dayMs;
const rejectedLargeArtifactRetentionMs = 7 * dayMs;

export type CandidateRetentionInput = Readonly<{
  candidate: Readonly<{
    id: string;
    status: CandidateStatus;
    publicationStatus?: "draft" | "published" | "archived";
    lastActivityAt: Date;
    rejectedAt: Date | null;
  }>;
  artifacts: readonly Readonly<{
    id: string;
    kind: string;
    byteSize: number;
    ephemeral: boolean;
    processingStatus: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
  }>[];
  now: Date;
  largeArtifactThresholdBytes: number;
}>;

export type CleanupInstruction = Readonly<{
  kind: "delete-artifact" | "purge-candidate";
  targetId: string;
  dueAt: Date;
  reason: "ephemeral-processing-terminal" | "rejected-large-artifact" | "unpublished-retention-expired";
}>;

const terminalProcessingStatuses = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export function planCandidateCleanup(input: CandidateRetentionInput): readonly CleanupInstruction[] {
  if (!Number.isSafeInteger(input.largeArtifactThresholdBytes) || input.largeArtifactThresholdBytes < 0) {
    throw new RangeError("largeArtifactThresholdBytes must be a non-negative safe integer.");
  }
  const instructions: CleanupInstruction[] = [];
  for (const artifact of input.artifacts) {
    if (
      artifact.ephemeral &&
      artifact.kind === "asr-temporary-audio" &&
      terminalProcessingStatuses.has(artifact.processingStatus)
    ) {
      instructions.push({
        kind: "delete-artifact",
        targetId: artifact.id,
        dueAt: input.now,
        reason: "ephemeral-processing-terminal",
      });
      continue;
    }
    if (
      input.candidate.status === "rejected" &&
      input.candidate.rejectedAt &&
      artifact.byteSize >= input.largeArtifactThresholdBytes
    ) {
      instructions.push({
        kind: "delete-artifact",
        targetId: artifact.id,
        dueAt: new Date(input.candidate.rejectedAt.getTime() + rejectedLargeArtifactRetentionMs),
        reason: "rejected-large-artifact",
      });
    }
  }
  if (input.candidate.publicationStatus !== "published" && input.candidate.publicationStatus !== "archived") {
    instructions.push({
      kind: "purge-candidate",
      targetId: input.candidate.id,
      dueAt: new Date(input.candidate.lastActivityAt.getTime() + unpublishedRetentionMs),
      reason: "unpublished-retention-expired",
    });
  }
  return instructions;
}
