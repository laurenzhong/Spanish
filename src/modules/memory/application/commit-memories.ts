import { classifyMemoryCandidate, type MemoryConflict } from "../domain/memory-conflict";
import type { MemoryCandidate } from "../domain/memory-candidate";
import type { MemoryRecord, MemoryRepository } from "../repositories/memory-repository";
import { recordDiagnosticEventSafely, type DiagnosticEventWriter } from "@/src/shared/observability";

export type MemoryCommitOutcome = Readonly<{
  candidateId: string;
  result: "inserted" | "duplicate" | "conflict" | "rejected";
  memory: MemoryRecord | null;
}>;

function outcome(candidate: MemoryCandidate, result: MemoryCommitOutcome["result"], memory: MemoryRecord | null): MemoryCommitOutcome {
  return { candidateId: candidate.candidateId, result, memory };
}

export async function commitMemories(input: Readonly<{
  repository: MemoryRepository;
  completed: boolean;
  candidates: readonly MemoryCandidate[];
  diagnostics?: DiagnosticEventWriter;
  requestId?: string;
}>): Promise<readonly MemoryCommitOutcome[]> {
  if (!input.completed || input.candidates.length === 0) {
    return input.candidates.map((candidate) => outcome(candidate, "rejected", null));
  }
  const results = await input.repository.transaction(async (repository) => {
    const results: MemoryCommitOutcome[] = [];
    for (const candidate of input.candidates) {
      const existing = await repository.findByFactKey(candidate.userId, candidate.characterKey, candidate.factKey);
      const decision: MemoryConflict = classifyMemoryCandidate(candidate, existing);
      if (decision.kind === "duplicate") {
        results.push(outcome(candidate, "duplicate", decision.existing as MemoryRecord));
        continue;
      }
      const status = decision.kind === "conflict" ? "conflict" : "candidate";
      const memory = await repository.insertCandidate({ ...candidate, shareScope: "private" }, status);
      results.push(outcome(candidate, status === "conflict" ? "conflict" : "inserted", memory));
    }
    return results;
  });
  for (const result of results) {
    if (result.result !== "conflict" || !result.memory) continue;
    await recordDiagnosticEventSafely(input.diagnostics, {
      userId: result.memory.userId,
      eventType: "memory.conflict",
      severity: "warning",
      dedupeKey: `memory-conflict:${result.memory.userId}:${result.candidateId}`,
      correlation: {
        requestId: input.requestId,
        conversationId: result.memory.sourceConversationId ?? undefined,
      },
      metadata: { characterKey: result.memory.characterKey, factKey: result.memory.factKey },
    });
  }
  return results;
}

export function listRelationshipMemories(repository: MemoryRepository, userId: string, characterKey: string) {
  return repository.listMemories(userId, characterKey);
}

export function listAllRelationshipMemories(repository: MemoryRepository, userId: string) {
  return repository.listAllMemories(userId);
}

export function listReadableRelationshipMemories(repository: MemoryRepository, userId: string, characterKey: string) {
  return repository.listReadableMemories(userId, characterKey);
}

export function deleteRelationshipMemory(repository: MemoryRepository, userId: string, memoryId: string) {
  return repository.deleteMemory(userId, memoryId);
}

export function grantRelationshipMemoryPermission(repository: MemoryRepository, userId: string, memoryId: string, targetCharacterKey: string) {
  return repository.grantPermission(userId, memoryId, targetCharacterKey);
}

export function revokeRelationshipMemoryPermission(repository: MemoryRepository, userId: string, memoryId: string, targetCharacterKey: string) {
  return repository.revokePermission(userId, memoryId, targetCharacterKey);
}
