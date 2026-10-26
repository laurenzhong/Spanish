import { z } from "zod";
import { luciaAuthoredOpening } from "../../src/modules/character-network/domain/lucia-opening";
import type { ConversationMessageRecord } from "../../src/modules/conversation/repositories/conversation-repository";
import type { ProactiveMessageCandidateRecord, ProactiveMessageRepository } from "../../src/modules/conversation/repositories/proactive-message-repository";
import type { MemoryRecord, MemoryRepository } from "../../src/modules/memory/repositories/memory-repository";

export type SandboxSnapshot = {
  userId: string;
  conversationId: string;
  messages: ConversationMessageRecord[];
  memories: MemoryRecord[];
  candidates: ProactiveMessageCandidateRecord[];
  relationshipStage: "new_contact" | "getting_to_know_you" | "familiar" | "close_friend";
  relationshipSummary: string | null;
};

const key = z.string().min(1).max(512);
const date = z.union([z.date(), z.iso.datetime({ offset: true })]).transform((value) => new Date(value));
const messageSchema = z.object({
  id: key, clientMessageId: key, generationId: key.nullable(),
  role: z.enum(["user", "character"]),
  status: z.enum(["streaming", "completed", "failed", "cancelled", "withdrawn"]),
  content: z.string(), replyToMessageId: key.nullable(),
  createdAt: date, completedAt: date.nullable(), sourceType: key.optional(),
}).strict();
const memorySchema = z.object({
  id: key, userId: key, characterKey: z.literal("lucia"), sourceConversationId: key.nullable(), sourceMessageId: key.nullable(),
  factKey: key, category: z.enum(["interest", "location", "background", "habit"]), content: z.string().min(1),
  confidence: z.number().min(0).max(1), sensitivity: z.enum(["normal", "sensitive", "private"]),
  shareScope: z.literal("private"), status: z.enum(["candidate", "confirmed", "rejected", "conflict"]),
  createdAt: date, updatedAt: date,
}).strict();
const candidateSchema = z.object({
  id: key, userId: key, characterKey: z.literal("lucia"), conversationId: key,
  sourceType: z.enum(["spontaneous_affection", "memory_callback", "follow_up_commitment", "daily_share", "relationship_milestone", "quiet_presence"]),
  dedupeKey: key, generationId: key, notBefore: date, expiresAt: date.nullable(),
  status: z.enum(["pending", "generating", "generated", "suppressed", "failed", "expired"]),
  messageId: key.nullable(), notificationStatus: z.literal("not_requested"), lastErrorCode: key.nullable(),
  createdAt: date, updatedAt: date,
}).strict();
const snapshotSchema = z.object({
  userId: key, conversationId: key, messages: z.array(messageSchema), memories: z.array(memorySchema), candidates: z.array(candidateSchema),
  relationshipStage: z.enum(["new_contact", "getting_to_know_you", "familiar", "close_friend"]), relationshipSummary: z.string().nullable(),
}).strict();

function fail(code: string): never { throw new Error(code); }
function copy<T>(value: T): T { return structuredClone(value); }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function unique(values: readonly string[]): boolean { return new Set(values).size === values.length; }

/** In-memory product repository adapters. No database, network, notification or relationship progression. */
export function createConversationSandbox(input: {
  userId: string; conversationId: string; now: () => Date; snapshot?: SandboxSnapshot;
}) {
  if (!key.safeParse(input.userId).success || !key.safeParse(input.conversationId).success) fail("SANDBOX_SCOPE_INVALID");
  const parsed = snapshotSchema.safeParse(input.snapshot ?? {
    userId: input.userId, conversationId: input.conversationId, messages: [], memories: [], candidates: [], relationshipStage: "new_contact", relationshipSummary: null,
  });
  if (!parsed.success) fail("SANDBOX_SNAPSHOT_INVALID");
  const state: SandboxSnapshot = parsed.data;
  if (state.userId !== input.userId || state.conversationId !== input.conversationId
    || !unique(state.messages.map((item) => item.id)) || !unique(state.messages.map((item) => item.clientMessageId))
    || !unique(state.memories.map((item) => item.id)) || !unique(state.candidates.map((item) => item.id))
    || !unique(state.candidates.map((item) => item.dedupeKey))) fail("SANDBOX_SNAPSHOT_INVALID");
  const messageById = new Map(state.messages.map((item) => [item.id, item]));
  for (const item of state.messages) {
    if ((item.status === "completed" && item.completedAt === null)
      || (item.replyToMessageId !== null && (item.role !== "character" || messageById.get(item.replyToMessageId)?.role !== "user"))) fail("SANDBOX_SNAPSHOT_INVALID");
  }
  for (const item of state.memories) {
    if (item.userId !== input.userId || item.sourceConversationId !== input.conversationId
      || !item.sourceMessageId || messageById.get(item.sourceMessageId)?.role !== "user"
      || messageById.get(item.sourceMessageId)?.status !== "completed") fail("SANDBOX_SNAPSHOT_INVALID");
  }
  for (const item of state.candidates) {
    const message = item.messageId ? messageById.get(item.messageId) : undefined;
    if (item.userId !== input.userId || item.conversationId !== input.conversationId
      || (item.expiresAt && item.expiresAt <= item.notBefore)
      || (item.status === "generated" && (!message || message.role !== "character" || message.status !== "completed" || message.sourceType !== "proactive" || message.generationId !== item.generationId))
      || (item.status !== "generated" && item.messageId !== null)) fail("SANDBOX_SNAPSHOT_INVALID");
  }
  if (state.messages.filter((item) => item.sourceType === "authored_opening").length > 1) fail("SANDBOX_SNAPSHOT_INVALID");

  function scope(userId: string, characterKey = "lucia") {
    if (userId !== input.userId || characterKey !== "lucia") fail("SANDBOX_SCOPE_MISMATCH");
  }
  function now(): Date {
    const value = date.safeParse(input.now());
    if (!value.success) fail("SANDBOX_CLOCK_INVALID");
    return value.data;
  }
  function appendMessage(message: ConversationMessageRecord): void {
    const parsed = messageSchema.safeParse(message);
    if (!parsed.success || (parsed.data.status === "completed" && parsed.data.completedAt === null)) fail("SANDBOX_MESSAGE_INVALID");
    const incoming = parsed.data;
    if ((incoming.sourceType === "authored_opening" || incoming.sourceType === "proactive") && incoming.role !== "character") fail("SANDBOX_MESSAGE_INVALID");
    if (incoming.replyToMessageId && (incoming.role !== "character" || !state.messages.some((item) => item.id === incoming.replyToMessageId && item.role === "user"))) fail("SANDBOX_MESSAGE_INVALID");
    const existing = state.messages.find((item) => item.id === incoming.id || item.clientMessageId === incoming.clientMessageId);
    if (existing) { if (!same(existing, incoming)) fail("SANDBOX_MESSAGE_CONFLICT"); return; }
    state.messages.push(copy(incoming));
  }
  function memoryRepositoryFor(get: () => MemoryRecord[], set: (memories: MemoryRecord[]) => void): MemoryRepository {
    return {
      async transaction(work) {
        const before = copy(get());
        let staged = copy(before);
        const result = await work(memoryRepositoryFor(() => staged, (memories) => { staged = memories; }));
        if (!same(before, get())) fail("SANDBOX_TRANSACTION_CONFLICT");
        set(staged);
        return result;
      },
      async findByFactKey(userId, characterKey, factKey) { scope(userId, characterKey); return copy(get().filter((item) => item.factKey === factKey)); },
      async insertCandidate(candidate, status = "candidate") {
        scope(candidate.userId, candidate.characterKey);
        if (candidate.conversationId !== input.conversationId || candidate.shareScope !== "private") fail("SANDBOX_SCOPE_MISMATCH");
        const source = state.messages.find((item) => item.id === candidate.sourceMessageId);
        if (!source || source.role !== "user" || source.status !== "completed") fail("SANDBOX_MEMORY_SOURCE_INVALID");
        const timestamp = now();
        const record = memorySchema.parse({
          id: candidate.candidateId, userId: candidate.userId, characterKey: "lucia", sourceConversationId: candidate.conversationId,
          sourceMessageId: candidate.sourceMessageId, factKey: candidate.factKey, category: candidate.category, content: candidate.content,
          confidence: candidate.confidence, sensitivity: candidate.sensitivity, shareScope: "private", status, createdAt: timestamp, updatedAt: timestamp,
        });
        const existing = get().find((item) => item.id === record.id);
        if (existing) {
          if (!same(existing, { ...record, createdAt: existing.createdAt, updatedAt: existing.updatedAt })) fail("SANDBOX_MEMORY_CONFLICT");
          return copy(existing);
        }
        set([...get(), record]); return copy(record);
      },
      async listAllMemories(userId) { scope(userId); return copy(get()); },
      async listMemories(userId, characterKey) { scope(userId, characterKey); return copy(get()); },
      async listReadableMemories(userId, characterKey) { scope(userId, characterKey); return copy(get().filter((item) => item.status !== "conflict" && item.status !== "rejected")); },
      async deleteMemory(userId, memoryId) { scope(userId); const before = get(); const after = before.filter((item) => item.id !== memoryId); set(after); return before.length !== after.length; },
      async deleteBySourceMessage(userId, sourceMessageId) { scope(userId); const before = get(); const after = before.filter((item) => item.sourceMessageId !== sourceMessageId); set(after); return before.length - after.length; },
      async grantPermission(userId) { scope(userId); fail("SANDBOX_SHARING_UNSUPPORTED"); },
      async revokePermission(userId) { scope(userId); fail("SANDBOX_SHARING_UNSUPPORTED"); },
    };
  }
  const memoryRepository = memoryRepositoryFor(() => state.memories, (memories) => { state.memories = memories; });
  const proactiveRepository: ProactiveMessageRepository = {
    async getConversationId(userId) { scope(userId); return input.conversationId; },
    async listRecentMessages(userId, limit = 100) {
      scope(userId);
      if (!Number.isInteger(limit) || limit < 1) fail("SANDBOX_LIMIT_INVALID");
      return copy(state.messages.filter((item) => item.status === "completed").slice(-Math.min(limit, 200)));
    },
    async getEligibilityState(userId, at) {
      scope(userId);
      if (!date.safeParse(at).success) fail("SANDBOX_CLOCK_INVALID");
      const completed = state.messages.filter((item) => item.status === "completed" && item.createdAt <= at);
      const users = completed.filter((item) => item.role === "user");
      const proactive = completed.filter((item) => item.sourceType === "proactive");
      const latest = (messages: ConversationMessageRecord[]) => messages.length ? new Date(Math.max(...messages.map((item) => item.createdAt.getTime()))) : null;
      const lastInteractionAt = latest(users); const lastProactiveMessageAt = latest(proactive);
      return {
        relationshipStatus: "active", relationshipStage: "new_contact", relationshipSummary: null, proactiveEnabled: true,
        lastInteractionAt, lastProactiveMessageAt,
        proactiveCount24h: proactive.filter((item) => item.createdAt.getTime() >= at.getTime() - 86_400_000).length,
        proactiveCount7d: proactive.filter((item) => item.createdAt.getTime() >= at.getTime() - 7 * 86_400_000).length,
        hasUnansweredProactive: Boolean(lastProactiveMessageAt && (!lastInteractionAt || lastProactiveMessageAt > lastInteractionAt)),
      };
    },
    async createCandidate(candidate) {
      scope(candidate.userId);
      if (candidate.conversationId !== input.conversationId) fail("SANDBOX_SCOPE_MISMATCH");
      const existing = state.candidates.find((item) => item.dedupeKey === candidate.dedupeKey);
      if (existing) {
        if (existing.sourceType !== candidate.sourceType) fail("SANDBOX_CANDIDATE_CONFLICT");
        if (existing.status !== "failed") return copy(existing);
        const updated = candidateSchema.parse({ ...existing, generationId: candidate.generationId, status: "generating", lastErrorCode: null, updatedAt: now() });
        state.candidates = state.candidates.map((item) => item.id === existing.id ? updated : item);
        return copy(updated);
      }
      const timestamp = now();
      let ordinal = state.candidates.length + 1;
      while (state.candidates.some((item) => item.id === `candidate-${ordinal}`)) ordinal++;
      const id = `candidate-${ordinal}`;
      const record = candidateSchema.parse({ ...candidate, id, characterKey: "lucia", expiresAt: candidate.expiresAt ?? null, status: "generating", messageId: null, notificationStatus: "not_requested", lastErrorCode: null, createdAt: timestamp, updatedAt: timestamp });
      if (record.expiresAt && record.expiresAt <= record.notBefore) fail("SANDBOX_CANDIDATE_INVALID");
      state.candidates.push(record); return copy(record);
    },
    async completeCandidate(completion) {
      scope(completion.userId);
      const candidate = state.candidates.find((item) => item.id === completion.candidateId);
      if (!candidate) fail("SANDBOX_CANDIDATE_UNAVAILABLE");
      if (candidate.generationId !== completion.generationId) fail("SANDBOX_GENERATION_CONFLICT");
      if (candidate.status === "generated") {
        const message = state.messages.find((item) => item.id === candidate.messageId);
        if (!message || message.id !== completion.messageId || message.content !== completion.content) fail("SANDBOX_MESSAGE_CONFLICT");
        return { candidate: copy(candidate), message: copy(message) };
      }
      if (candidate.status !== "generating") fail("SANDBOX_GENERATION_CONFLICT");
      const timestamp = now();
      if (candidate.expiresAt && candidate.expiresAt <= timestamp) fail("SANDBOX_CANDIDATE_EXPIRED");
      if (candidate.notBefore > timestamp) fail("SANDBOX_CANDIDATE_NOT_READY");
      if (!completion.content.trim()) fail("SANDBOX_MESSAGE_INVALID");
      const message: ConversationMessageRecord = {
        id: completion.messageId, clientMessageId: `proactive-${candidate.id}`, generationId: completion.generationId, role: "character", status: "completed",
        sourceType: "proactive", content: completion.content, replyToMessageId: null, createdAt: timestamp, completedAt: timestamp,
      };
      appendMessage(message);
      const updated: ProactiveMessageCandidateRecord = { ...candidate, status: "generated", messageId: message.id, updatedAt: timestamp };
      state.candidates = state.candidates.map((item) => item.id === candidate.id ? updated : item);
      return { candidate: copy(updated), message: copy(message) };
    },
    async failCandidate(failure) {
      scope(failure.userId);
      const existing = state.candidates.find((item) => item.id === failure.candidateId);
      if (!existing) fail("SANDBOX_CANDIDATE_UNAVAILABLE");
      if (existing.status !== "generating") return;
      if (!key.safeParse(failure.errorCode).success) fail("SANDBOX_ERROR_CODE_INVALID");
      state.candidates = state.candidates.map((item) => item.id === existing.id ? { ...item, status: "failed", lastErrorCode: failure.errorCode, updatedAt: now() } : item);
    },
  };
  return {
    memoryRepository, proactiveRepository, appendMessage,
    setRelationship(stage: SandboxSnapshot["relationshipStage"], summary: string | null): void {
      state.relationshipStage = stage;
      state.relationshipSummary = summary;
    },
    snapshot(): SandboxSnapshot { return copy(state); },
    open(): void {
      if (state.messages.length) return;
      if (state.memories.length || state.candidates.length) fail("SANDBOX_INITIAL_STATE_INVALID");
      const timestamp = now();
      appendMessage({ ...luciaAuthoredOpening, id: "authored-opening", role: "character", status: "completed", replyToMessageId: null, sourceType: "authored_opening", createdAt: timestamp, completedAt: timestamp });
    },
  };
}
