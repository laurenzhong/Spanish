import { describe, expect, it } from "vitest";

import {
  classifyMemoryCandidate,
  commitMemories,
  createCandidateId,
  extractMemories,
  type MemoryCandidate,
  type MemoryRecord,
  type MemoryRepository,
} from "@/src/modules/memory";

const baseTurn = {
  userMessage: { id: "user-message-1", role: "user" as const, status: "completed" as const, content: "Me gusta la fotografía y vivo en Madrid." },
  assistantMessage: { id: "assistant-message-1", role: "character" as const, status: "completed" as const, content: "Qué interesante." },
};

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    candidateId: "candidate-1",
    userId: "user-1",
    characterKey: "lucia",
    characterVersion: 1,
    conversationId: "conversation-1",
    sourceMessageId: "user-message-1",
    factKey: "interest.preference",
    category: "interest",
    content: "la fotografía",
    confidence: 0.9,
    sensitivity: "normal",
    shareScope: "private",
    ...overrides,
  };
}

function fakeRepository(initial: MemoryRecord[] = []): MemoryRepository {
  const memories = [...initial];
  return {
    async transaction(work) { return work(this); },
    async findByFactKey(userId, characterKey, factKey) {
      return memories.filter((memory) => memory.userId === userId && memory.characterKey === characterKey && memory.factKey === factKey);
    },
    async insertCandidate(input, status = "candidate") {
      const now = new Date("2026-08-24T00:00:00.000Z");
      const record: MemoryRecord = { id: `memory-${memories.length + 1}`, userId: input.userId, characterKey: input.characterKey, sourceConversationId: input.conversationId, sourceMessageId: input.sourceMessageId, factKey: input.factKey, category: input.category, content: input.content, confidence: input.confidence, sensitivity: input.sensitivity, shareScope: "private", status, createdAt: now, updatedAt: now };
      memories.push(record);
      return record;
    },
    async listMemories(userId, characterKey) { return memories.filter((memory) => memory.userId === userId && memory.characterKey === characterKey); },
    async listReadableMemories(userId, characterKey) { return memories.filter((memory) => memory.userId === userId && memory.characterKey === characterKey); },
    async deleteMemory(userId, memoryId) { const index = memories.findIndex((memory) => memory.userId === userId && memory.id === memoryId); if (index < 0) return false; memories.splice(index, 1); return true; },
    async grantPermission() {},
    async revokePermission() {},
  };
}

describe("relationship memory extraction", () => {
  it("rejects an incomplete or failed conversation round", () => {
    expect(extractMemories({ userId: "user-1", characterKey: "lucia", conversationId: "conversation-1", turn: { ...baseTurn, status: "streaming" } })).toEqual([]);
    expect(extractMemories({ userId: "user-1", characterKey: "lucia", conversationId: "conversation-1", turn: { ...baseTurn, status: "done", assistantMessage: { ...baseTurn.assistantMessage, status: "completed" } } })).not.toEqual([]);
  });

  it("extracts deterministic short facts only from first-person user text", () => {
    const input = { userId: "user-1", characterKey: "lucia", conversationId: "conversation-1", turn: { ...baseTurn, status: "done" as const } };
    const first = extractMemories(input);
    const second = extractMemories(input);
    expect(first).toEqual(second);
    expect(first.map((memory) => [memory.category, memory.content])).toEqual([
      ["interest", "la fotografía"],
      ["location", "Madrid"],
    ]);
    expect(first.every((memory) => memory.shareScope === "private")).toBe(true);
    expect(first.every((memory) => !memory.content.includes("Qué interesante"))).toBe(true);
    expect(createCandidateId({ userId: "user-1", characterKey: "lucia", conversationId: "conversation-1", sourceMessageId: "user-message-1", factKey: "interest.preference", content: "la fotografía" })).toBe(first[0]?.candidateId);
  });
});

describe("memory conflict and commit rules", () => {
  it("classifies same fact content as duplicate and a changed fact as conflict", () => {
    const existing = [{ id: "memory-1", factKey: "location.current", content: "Madrid", status: "candidate" as const }];
    expect(classifyMemoryCandidate(candidate({ factKey: "location.current", category: "location", content: "Madrid" }), existing).kind).toBe("duplicate");
    expect(classifyMemoryCandidate(candidate({ factKey: "location.current", category: "location", content: "Barcelona" }), existing).kind).toBe("conflict");
  });

  it("is idempotent, preserves old values, and refuses incomplete commits", async () => {
    const repository = fakeRepository();
    const first = await commitMemories({ repository, completed: true, candidates: [candidate()] });
    const duplicate = await commitMemories({ repository, completed: true, candidates: [candidate()] });
    const conflict = await commitMemories({ repository, completed: true, candidates: [candidate({ content: "el senderismo" })] });
    const rejected = await commitMemories({ repository, completed: false, candidates: [candidate({ candidateId: "candidate-2" })] });
    expect(first[0]?.result).toBe("inserted");
    expect(duplicate[0]?.result).toBe("duplicate");
    expect(conflict[0]?.result).toBe("conflict");
    expect(rejected[0]?.result).toBe("rejected");
    expect(await repository.listMemories("user-1", "lucia")).toHaveLength(2);
    expect((await repository.listMemories("user-1", "lucia"))[0]?.content).toBe("la fotografía");
  });
});
