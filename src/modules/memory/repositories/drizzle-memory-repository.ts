import { and, asc, eq, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type { MemoryRecord, MemoryRepository, MemoryStatus } from "./memory-repository";

type MemoryDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

async function characterId<TResult extends PgQueryResultHKT>(database: MemoryDatabase<TResult>, characterKey: string, version = 1): Promise<string> {
  const [character] = await database.select({ id: schema.characters.id }).from(schema.characters)
    .where(and(eq(schema.characters.stableKey, characterKey), eq(schema.characters.characterVersion, version))).limit(1);
  if (!character) throw new Error("CHARACTER_UNAVAILABLE");
  return character.id;
}

function toRecord(row: typeof schema.relationshipMemories.$inferSelect, characterKey: string): MemoryRecord {
  return {
    id: row.id,
    userId: row.userId,
    characterKey,
    sourceConversationId: row.sourceConversationId,
    sourceMessageId: row.sourceMessageId,
    factKey: row.factKey,
    category: row.category as MemoryRecord["category"],
    content: row.content,
    confidence: row.confidence,
    sensitivity: row.sensitivity,
    shareScope: row.shareScope,
    status: row.status as MemoryStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleMemoryRepository<TResult extends PgQueryResultHKT>(database: MemoryDatabase<TResult>): MemoryRepository {
  return {
    async transaction(work) {
      return database.transaction((transaction) => work(createDrizzleMemoryRepository(transaction)));
    },

    async findByFactKey(userId, characterKey, factKey) {
      const id = await characterId(database, characterKey);
      const rows = await database.select().from(schema.relationshipMemories)
        .where(and(eq(schema.relationshipMemories.userId, userId), eq(schema.relationshipMemories.characterId, id), eq(schema.relationshipMemories.factKey, factKey)))
        .orderBy(asc(schema.relationshipMemories.createdAt));
      return rows.map((row) => toRecord(row, characterKey));
    },

    async insertCandidate(candidate, status = "candidate") {
      const id = await characterId(database, candidate.characterKey, candidate.characterVersion);
      const [row] = await database.insert(schema.relationshipMemories).values({
        userId: candidate.userId,
        characterId: id,
        sourceConversationId: candidate.conversationId,
        sourceMessageId: candidate.sourceMessageId,
        factKey: candidate.factKey,
        category: candidate.category,
        content: candidate.content,
        confidence: candidate.confidence,
        sensitivity: candidate.sensitivity,
        shareScope: "private",
        status,
      }).returning();
      if (!row) throw new Error("MEMORY_INSERT_FAILED");
      return toRecord(row, candidate.characterKey);
    },

    async listAllMemories(userId) {
      const rows = await database
        .select({
          characterKey: schema.characters.stableKey,
          memory: schema.relationshipMemories,
        })
        .from(schema.relationshipMemories)
        .innerJoin(
          schema.characters,
          eq(schema.relationshipMemories.characterId, schema.characters.id),
        )
        .where(eq(schema.relationshipMemories.userId, userId))
        .orderBy(asc(schema.relationshipMemories.createdAt));
      return rows.map((row) => toRecord(row.memory, row.characterKey));
    },

    async listMemories(userId, characterKey) {
      const id = await characterId(database, characterKey);
      const rows = await database.select().from(schema.relationshipMemories)
        .where(and(eq(schema.relationshipMemories.userId, userId), eq(schema.relationshipMemories.characterId, id)))
        .orderBy(asc(schema.relationshipMemories.createdAt));
      return rows.map((row) => toRecord(row, characterKey));
    },

    async listReadableMemories(userId, characterKey) {
      const id = await characterId(database, characterKey);
      const rows = await database.select({ memory: schema.relationshipMemories }).from(schema.relationshipMemories)
        .leftJoin(schema.memorySharingPermissions, and(
          eq(schema.memorySharingPermissions.memoryId, schema.relationshipMemories.id),
          eq(schema.memorySharingPermissions.targetCharacterId, id),
          eq(schema.memorySharingPermissions.userId, userId),
          eq(schema.memorySharingPermissions.isAllowed, true),
        ))
        .where(and(eq(schema.relationshipMemories.userId, userId), or(
          eq(schema.relationshipMemories.characterId, id),
          eq(schema.memorySharingPermissions.targetCharacterId, id),
        )))
        .orderBy(asc(schema.relationshipMemories.createdAt));
      return rows.map((row) => toRecord(row.memory, characterKey));
    },

    async deleteMemory(userId, memoryId) {
      const deleted = await database.delete(schema.relationshipMemories)
        .where(and(eq(schema.relationshipMemories.id, memoryId), eq(schema.relationshipMemories.userId, userId)))
        .returning({ id: schema.relationshipMemories.id });
      return deleted.length > 0;
    },

    async grantPermission(userId, memoryId, targetCharacterKey) {
      const targetId = await characterId(database, targetCharacterKey);
      const owned = await database.select({ id: schema.relationshipMemories.id }).from(schema.relationshipMemories)
        .where(and(eq(schema.relationshipMemories.id, memoryId), eq(schema.relationshipMemories.userId, userId))).limit(1);
      if (!owned[0]) throw new Error("MEMORY_NOT_FOUND");
      await database.insert(schema.memorySharingPermissions).values({ userId, memoryId, targetCharacterId: targetId, isAllowed: true })
        .onConflictDoUpdate({ target: [schema.memorySharingPermissions.memoryId, schema.memorySharingPermissions.targetCharacterId], set: { isAllowed: true, updatedAt: new Date(), grantedAt: new Date() } });
      await database.update(schema.relationshipMemories).set({ shareScope: "explicit", updatedAt: new Date() }).where(eq(schema.relationshipMemories.id, memoryId));
    },

    async revokePermission(userId, memoryId, targetCharacterKey) {
      const targetId = await characterId(database, targetCharacterKey);
      await database.update(schema.memorySharingPermissions).set({ isAllowed: false, updatedAt: new Date() })
        .where(and(eq(schema.memorySharingPermissions.userId, userId), eq(schema.memorySharingPermissions.memoryId, memoryId), eq(schema.memorySharingPermissions.targetCharacterId, targetId)));
    },
  };
}
