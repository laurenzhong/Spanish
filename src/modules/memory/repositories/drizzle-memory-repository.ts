import { and, asc, eq, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type { MemoryRecord, MemoryRepository, MemoryStatus } from "./memory-repository";

type MemoryDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

/**
 * Resolves a character's stable identity plus the revision its pointer names.
 * Relationship memories and sharing permissions are user state, so they are
 * read and written through `identity_id`; `character_id` is still written on
 * every insert so a rollback to the revision-keyed reads stays possible
 * (ADR 0014). A missing identity fails closed.
 */
async function characterIdentity<TResult extends PgQueryResultHKT>(
  database: MemoryDatabase<TResult>,
  characterKey: string,
): Promise<Readonly<{ identityId: string; revisionId: string }>> {
  const [identity] = await database
    .select({ identityId: schema.characterIdentities.id, revisionId: schema.characterIdentities.currentCharacterId })
    .from(schema.characterIdentities)
    .where(eq(schema.characterIdentities.stableKey, characterKey))
    .limit(1);
  if (!identity) throw new Error("CHARACTER_UNAVAILABLE");
  return identity;
}

/**
 * Grants (or re-grants) one sharing permission for a target identity.
 * `memory_sharing_permissions` is unique per (memory, revision), so the
 * identity pair is checked first: an upsert keyed on the revision would insert
 * a second grant once the pointer moves to a newer one.
 */
async function grantMemoryPermission<TResult extends PgQueryResultHKT>(
  database: MemoryDatabase<TResult>,
  input: Readonly<{ userId: string; memoryId: string; targetIdentityId: string; targetCharacterId: string }>,
): Promise<void> {
  const now = new Date();
  const [existing] = await database
    .select({ targetIdentityId: schema.memorySharingPermissions.targetIdentityId })
    .from(schema.memorySharingPermissions)
    .where(and(
      eq(schema.memorySharingPermissions.userId, input.userId),
      eq(schema.memorySharingPermissions.memoryId, input.memoryId),
      eq(schema.memorySharingPermissions.targetIdentityId, input.targetIdentityId),
    ))
    .limit(1);
  if (existing) {
    await database.update(schema.memorySharingPermissions)
      .set({ isAllowed: true, updatedAt: now, grantedAt: now })
      .where(and(
        eq(schema.memorySharingPermissions.userId, input.userId),
        eq(schema.memorySharingPermissions.memoryId, input.memoryId),
        eq(schema.memorySharingPermissions.targetIdentityId, input.targetIdentityId),
      ));
    return;
  }
  await database.insert(schema.memorySharingPermissions).values({
    userId: input.userId,
    memoryId: input.memoryId,
    targetCharacterId: input.targetCharacterId,
    targetIdentityId: input.targetIdentityId,
    isAllowed: true,
  }).onConflictDoNothing({
    target: [schema.memorySharingPermissions.memoryId, schema.memorySharingPermissions.targetCharacterId],
  });
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
      const identity = await characterIdentity(database, characterKey);
      const rows = await database.select().from(schema.relationshipMemories)
        .where(and(eq(schema.relationshipMemories.userId, userId), eq(schema.relationshipMemories.identityId, identity.identityId), eq(schema.relationshipMemories.factKey, factKey)))
        .orderBy(asc(schema.relationshipMemories.createdAt));
      return rows.map((row) => toRecord(row, characterKey));
    },

    async insertCandidate(candidate, status = "candidate") {
      const identity = await characterIdentity(database, candidate.characterKey);
      const [row] = await database.insert(schema.relationshipMemories).values({
        userId: candidate.userId,
        characterId: identity.revisionId,
        identityId: identity.identityId,
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
          characterKey: schema.characterIdentities.stableKey,
          memory: schema.relationshipMemories,
        })
        .from(schema.relationshipMemories)
        .innerJoin(
          schema.characterIdentities,
          eq(schema.relationshipMemories.identityId, schema.characterIdentities.id),
        )
        .where(eq(schema.relationshipMemories.userId, userId))
        .orderBy(asc(schema.relationshipMemories.createdAt));
      return rows.map((row) => toRecord(row.memory, row.characterKey));
    },

    async listMemories(userId, characterKey) {
      const identity = await characterIdentity(database, characterKey);
      const rows = await database.select().from(schema.relationshipMemories)
        .where(and(eq(schema.relationshipMemories.userId, userId), eq(schema.relationshipMemories.identityId, identity.identityId)))
        .orderBy(asc(schema.relationshipMemories.createdAt));
      return rows.map((row) => toRecord(row, characterKey));
    },

    async listReadableMemories(userId, characterKey) {
      const identity = await characterIdentity(database, characterKey);
      const rows = await database.select({ memory: schema.relationshipMemories }).from(schema.relationshipMemories)
        .leftJoin(schema.memorySharingPermissions, and(
          eq(schema.memorySharingPermissions.memoryId, schema.relationshipMemories.id),
          eq(schema.memorySharingPermissions.targetIdentityId, identity.identityId),
          eq(schema.memorySharingPermissions.userId, userId),
          eq(schema.memorySharingPermissions.isAllowed, true),
        ))
        .where(and(eq(schema.relationshipMemories.userId, userId), or(
          eq(schema.relationshipMemories.identityId, identity.identityId),
          eq(schema.memorySharingPermissions.targetIdentityId, identity.identityId),
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

    async deleteBySourceMessage(userId, sourceMessageId) {
      const deleted = await database.delete(schema.relationshipMemories)
        .where(and(
          eq(schema.relationshipMemories.userId, userId),
          eq(schema.relationshipMemories.sourceMessageId, sourceMessageId),
        ))
        .returning({ id: schema.relationshipMemories.id });
      return deleted.length;
    },

    async grantPermission(userId, memoryId, targetCharacterKey) {
      const target = await characterIdentity(database, targetCharacterKey);
      const owned = await database.select({ id: schema.relationshipMemories.id }).from(schema.relationshipMemories)
        .where(and(eq(schema.relationshipMemories.id, memoryId), eq(schema.relationshipMemories.userId, userId))).limit(1);
      if (!owned[0]) throw new Error("MEMORY_NOT_FOUND");
      await grantMemoryPermission(database, {
        userId,
        memoryId,
        targetIdentityId: target.identityId,
        targetCharacterId: target.revisionId,
      });
      await database.update(schema.relationshipMemories).set({ shareScope: "explicit", updatedAt: new Date() }).where(eq(schema.relationshipMemories.id, memoryId));
    },

    async revokePermission(userId, memoryId, targetCharacterKey) {
      const target = await characterIdentity(database, targetCharacterKey);
      await database.update(schema.memorySharingPermissions).set({ isAllowed: false, updatedAt: new Date() })
        .where(and(eq(schema.memorySharingPermissions.userId, userId), eq(schema.memorySharingPermissions.memoryId, memoryId), eq(schema.memorySharingPermissions.targetIdentityId, target.identityId)));
    },
  };
}
