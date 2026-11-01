// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createConversationSandbox, type SandboxSnapshot } from "../../scripts/conversation-evaluation/sandbox";
import { luciaAuthoredOpening } from "../../src/modules/character-network/domain/lucia-opening";
import type { ConversationMessageRecord } from "../../src/modules/conversation/repositories/conversation-repository";
import type { MemoryCandidate } from "../../src/modules/memory/domain/memory-candidate";

const date = new Date("2026-10-25T10:00:00Z");
const scope = { userId: "eval-user", conversationId: "eval-conversation", now: () => date };
function message(id = "user-1", patch: Partial<ConversationMessageRecord> = {}): ConversationMessageRecord {
  return { id, clientMessageId: id, generationId: "generation-1", role: "user", status: "completed", content: "Me gusta la música.", replyToMessageId: null, createdAt: date, completedAt: date, sourceType: "conversation", ...patch };
}
function memory(patch: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return { candidateId: "memory-1", userId: scope.userId, characterKey: "lucia", characterVersion: 3, conversationId: scope.conversationId, sourceMessageId: "user-1", factKey: "interest.preference", category: "interest", content: "la música", confidence: 0.9, sensitivity: "normal", shareScope: "private", ...patch };
}
function candidate(generationId = "generation-proactive") {
  return { userId: scope.userId, conversationId: scope.conversationId, sourceType: "daily_share" as const, dedupeKey: "daily-share-2026-10-25", generationId, notBefore: date, expiresAt: new Date(date.getTime() + 86_400_000) };
}

describe("offline conversation sandbox", () => {
  it("starts empty and opens once with the exact product greeting", () => {
    const sandbox = createConversationSandbox(scope);
    expect(sandbox.snapshot()).toMatchObject({ messages: [], memories: [], candidates: [], relationshipStage: "new_contact", relationshipSummary: null });
    sandbox.open(); sandbox.open();
    expect(sandbox.snapshot().messages).toHaveLength(1);
    expect(sandbox.snapshot().messages[0]).toMatchObject({ content: luciaAuthoredOpening.content, clientMessageId: luciaAuthoredOpening.clientMessageId, sourceType: "authored_opening", status: "completed" });
    expect(luciaAuthoredOpening.content).toBe("¡Hola! Soy Lucía, de Madrid. Me gusta fijarme en los pequeños detalles de la ciudad. ¿Qué te gusta hacer en tu tiempo libre?");
    expect(readFileSync("src/modules/character-network/repositories/drizzle-lucia-contact-repository.ts", "utf8")).toContain("luciaAuthoredOpening as authoredOpening");
  });

  it("does not add a greeting to restored nonempty histories and rehydrates dates", () => {
    const original = createConversationSandbox(scope);
    original.appendMessage(message());
    const saved = JSON.parse(JSON.stringify(original.snapshot())) as SandboxSnapshot;
    const restored = createConversationSandbox({ ...scope, snapshot: saved });
    restored.open();
    expect(restored.snapshot().messages).toHaveLength(1);
    expect(restored.snapshot().messages[0].createdAt).toBeInstanceOf(Date);
    saved.messages[0] = message("other");
    expect(restored.snapshot().messages[0].id).toBe("user-1");
  });

  it("copies messages and snapshots, preserves full history and rejects changed duplicate IDs", async () => {
    const sandbox = createConversationSandbox(scope);
    for (let index = 0; index < 120; index++) sandbox.appendMessage(message(`user-${index}`));
    sandbox.appendMessage(message("user-0"));
    expect(sandbox.snapshot().messages).toHaveLength(120);
    expect((await sandbox.proactiveRepository.listRecentMessages(scope.userId, 100))).toHaveLength(100);
    const snapshot = sandbox.snapshot(); snapshot.messages.length = 0;
    expect(sandbox.snapshot().messages).toHaveLength(120);
    expect(() => sandbox.appendMessage(message("user-0", { content: "different" }))).toThrow("SANDBOX_MESSAGE_CONFLICT");
  });

  it("isolates scopes and rejects hostile restored state", async () => {
    const a = createConversationSandbox(scope);
    a.appendMessage(message());
    await a.memoryRepository.insertCandidate(memory());
    const b = createConversationSandbox({ ...scope, userId: "other-user", conversationId: "other-conversation" });
    expect(b.snapshot().messages).toEqual([]);
    expect(b.snapshot().memories).toEqual([]);
    await expect(a.memoryRepository.listAllMemories("other-user")).rejects.toThrow("SANDBOX_SCOPE_MISMATCH");
    await expect(a.proactiveRepository.getConversationId("other-user")).rejects.toThrow("SANDBOX_SCOPE_MISMATCH");
    expect(() => createConversationSandbox({ ...scope, userId: "other-user", snapshot: a.snapshot() })).toThrow("SANDBOX_SNAPSHOT_INVALID");
    expect(() => createConversationSandbox({ ...scope, snapshot: { ...a.snapshot(), relationshipStage: "romantic" } as unknown as SandboxSnapshot })).toThrow("SANDBOX_SNAPSHOT_INVALID");
    const poisoned = a.snapshot(); poisoned.memories[0] = { ...poisoned.memories[0], characterKey: "mateo" };
    expect(() => createConversationSandbox({ ...scope, snapshot: poisoned })).toThrow("SANDBOX_SNAPSHOT_INVALID");
  });

  it("rolls memory transactions back and does not leak rejected or conflicting memories", async () => {
    const sandbox = createConversationSandbox(scope); sandbox.appendMessage(message());
    await expect(sandbox.memoryRepository.transaction(async (repository) => {
      await repository.insertCandidate(memory()); throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(sandbox.snapshot().memories).toEqual([]);
    await sandbox.memoryRepository.insertCandidate(memory());
    await sandbox.memoryRepository.insertCandidate(memory({ candidateId: "conflict", factKey: "location.current", content: "Madrid" }), "conflict");
    await sandbox.memoryRepository.insertCandidate(memory({ candidateId: "rejected", factKey: "background.work", content: "oficina" }), "rejected");
    expect(await sandbox.memoryRepository.listReadableMemories(scope.userId, "lucia")).toHaveLength(1);
    expect(await sandbox.memoryRepository.listAllMemories(scope.userId)).toHaveLength(3);
    await expect(sandbox.memoryRepository.insertCandidate(memory({ userId: "other-user" }))).rejects.toThrow("SANDBOX_SCOPE_MISMATCH");
    await expect(sandbox.memoryRepository.grantPermission(scope.userId, "memory-1", "mateo")).rejects.toThrow("SANDBOX_SHARING_UNSUPPORTED");
  });

  it("deduplicates exact memory inserts and deletes only scoped sources", async () => {
    const sandbox = createConversationSandbox(scope); sandbox.appendMessage(message());
    const first = await sandbox.memoryRepository.insertCandidate(memory());
    expect(await sandbox.memoryRepository.insertCandidate(memory())).toEqual(first);
    await expect(sandbox.memoryRepository.insertCandidate(memory({ content: "otro" }))).rejects.toThrow("SANDBOX_MEMORY_CONFLICT");
    expect(await sandbox.memoryRepository.deleteBySourceMessage?.(scope.userId, "not-present")).toBe(0);
    expect(await sandbox.memoryRepository.deleteBySourceMessage?.(scope.userId, "user-1")).toBe(1);
  });

  it("rejects incomplete memory sources and does not overwrite concurrent transaction changes", async () => {
    const sandbox = createConversationSandbox(scope);
    sandbox.appendMessage(message("partial", { status: "streaming", completedAt: null }));
    await expect(sandbox.memoryRepository.insertCandidate(memory({ sourceMessageId: "partial" }))).rejects.toThrow("SANDBOX_MEMORY_SOURCE_INVALID");
    sandbox.appendMessage(message());
    await expect(sandbox.memoryRepository.transaction(async (repository) => {
      await repository.insertCandidate(memory());
      await sandbox.memoryRepository.insertCandidate(memory({ candidateId: "concurrent", factKey: "habit.routine", content: "leer" }));
    })).rejects.toThrow("SANDBOX_TRANSACTION_CONFLICT");
    expect(sandbox.snapshot().memories.map((item) => item.id)).toEqual(["concurrent"]);
  });

  it("counts only completed user/proactive messages and respects daily and weekly windows", async () => {
    const sandbox = createConversationSandbox(scope); sandbox.open();
    sandbox.appendMessage(message("partial", { status: "cancelled", completedAt: null }));
    expect((await sandbox.proactiveRepository.getEligibilityState(scope.userId, date)).lastInteractionAt).toBeNull();
    sandbox.appendMessage(message());
    const pending = await sandbox.proactiveRepository.createCandidate(candidate());
    await sandbox.proactiveRepository.completeCandidate({ userId: scope.userId, candidateId: pending.id, generationId: pending.generationId, messageId: "proactive-1", content: "Hoy hace un día tranquilo." });
    expect(await sandbox.proactiveRepository.getEligibilityState(scope.userId, date)).toMatchObject({ lastInteractionAt: date, lastProactiveMessageAt: date, proactiveCount24h: 1, proactiveCount7d: 1, relationshipStage: "new_contact" });
    expect(await sandbox.proactiveRepository.getEligibilityState(scope.userId, new Date(date.getTime() + 2 * 86_400_000))).toMatchObject({ proactiveCount24h: 0, proactiveCount7d: 1 });
    expect(await sandbox.proactiveRepository.getEligibilityState(scope.userId, new Date(date.getTime() + 8 * 86_400_000))).toMatchObject({ proactiveCount24h: 0, proactiveCount7d: 0 });
    expect((await sandbox.proactiveRepository.listRecentMessages(scope.userId)).some((item) => item.id === "partial")).toBe(false);
  });

  it("deduplicates candidate generation and completion while rejecting stale callbacks", async () => {
    const sandbox = createConversationSandbox(scope); sandbox.open(); sandbox.appendMessage(message());
    const first = await sandbox.proactiveRepository.createCandidate(candidate());
    expect(await sandbox.proactiveRepository.createCandidate(candidate("other-generation"))).toEqual(first);
    const completion = { userId: scope.userId, candidateId: first.id, generationId: first.generationId, messageId: "proactive-1", content: "Me apetecía contarte algo." };
    await expect(sandbox.proactiveRepository.completeCandidate({ ...completion, generationId: "stale" })).rejects.toThrow("SANDBOX_GENERATION_CONFLICT");
    const done = await sandbox.proactiveRepository.completeCandidate(completion);
    expect(await sandbox.proactiveRepository.completeCandidate(completion)).toEqual(done);
    await expect(sandbox.proactiveRepository.completeCandidate({ ...completion, content: "changed" })).rejects.toThrow("SANDBOX_MESSAGE_CONFLICT");
    expect(sandbox.snapshot().messages.filter((item) => item.sourceType === "proactive")).toHaveLength(1);
    await sandbox.proactiveRepository.failCandidate({ userId: scope.userId, candidateId: first.id, errorCode: "late-failure" });
    expect(sandbox.snapshot().candidates[0].status).toBe("generated");
  });

  it("retries failed candidates with a new generation but cannot complete an expired candidate", async () => {
    let now = date;
    const sandbox = createConversationSandbox({ ...scope, now: () => now }); sandbox.open();
    const first = await sandbox.proactiveRepository.createCandidate(candidate());
    await sandbox.proactiveRepository.failCandidate({ userId: scope.userId, candidateId: first.id, errorCode: "provider-timeout" });
    const retry = await sandbox.proactiveRepository.createCandidate(candidate("generation-retry"));
    expect(retry).toMatchObject({ id: first.id, generationId: "generation-retry", status: "generating", lastErrorCode: null });
    now = new Date(date.getTime() + 2 * 86_400_000);
    await expect(sandbox.proactiveRepository.completeCandidate({ userId: scope.userId, candidateId: retry.id, generationId: retry.generationId, messageId: "late-message", content: "Hola." })).rejects.toThrow("SANDBOX_CANDIDATE_EXPIRED");
    expect(sandbox.snapshot().messages).toHaveLength(1);
  });

  it("rejects duplicate IDs, invalid dates, orphan memory and orphan generated candidates on restore", async () => {
    const sandbox = createConversationSandbox(scope); sandbox.appendMessage(message());
    const duplicate = sandbox.snapshot(); duplicate.messages.push(message());
    expect(() => createConversationSandbox({ ...scope, snapshot: duplicate })).toThrow("SANDBOX_SNAPSHOT_INVALID");
    const invalidDate = sandbox.snapshot(); invalidDate.messages[0] = { ...invalidDate.messages[0], createdAt: new Date(NaN) };
    expect(() => createConversationSandbox({ ...scope, snapshot: invalidDate })).toThrow("SANDBOX_SNAPSHOT_INVALID");
    await sandbox.memoryRepository.insertCandidate(memory());
    const orphanMemory = sandbox.snapshot(); orphanMemory.memories[0] = { ...orphanMemory.memories[0], sourceMessageId: "missing" };
    expect(() => createConversationSandbox({ ...scope, snapshot: orphanMemory })).toThrow("SANDBOX_SNAPSHOT_INVALID");
    const orphan = sandbox.snapshot(); orphan.candidates.push({ ...candidate(), id: "candidate-1", characterKey: "lucia", status: "generated", messageId: "missing", notificationStatus: "not_requested", lastErrorCode: null, createdAt: date, updatedAt: date, expiresAt: null });
    expect(() => createConversationSandbox({ ...scope, snapshot: orphan })).toThrow("SANDBOX_SNAPSHOT_INVALID");
  });
});
