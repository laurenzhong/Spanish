import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type { IntroductionOffer } from "../domain";
import type {
  CharacterRelationshipRecord,
  IntroductionRecord,
  IntroductionRepository,
} from "./introduction-repository";

type NetworkDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

async function characterId<TResult extends PgQueryResultHKT>(
  database: NetworkDatabase<TResult>,
  characterKey: string,
  version: number,
): Promise<string> {
  const [character] = await database
    .select({ id: schema.characters.id })
    .from(schema.characters)
    .where(and(eq(schema.characters.stableKey, characterKey), eq(schema.characters.characterVersion, version)))
    .limit(1);
  if (!character) throw new Error("CHARACTER_UNAVAILABLE");
  return character.id;
}

function toOffer(row: typeof schema.characterIntroductionOffers.$inferSelect): IntroductionRecord {
  return {
    id: row.id,
    offerKey: row.offerKey,
    userId: row.userId,
    sourceCharacterKey: (row.context as { sourceCharacterKey?: string } | null)?.sourceCharacterKey ?? "lucia",
    sourceCharacterVersion: Number((row.context as { sourceCharacterVersion?: number } | null)?.sourceCharacterVersion ?? 1),
    targetCharacterKey: (row.context as { targetCharacterKey?: string } | null)?.targetCharacterKey ?? "",
    targetCharacterVersion: Number((row.context as { targetCharacterVersion?: number } | null)?.targetCharacterVersion ?? 1),
    reasonCode: row.reasonCode as IntroductionOffer["reasonCode"],
    reasonText: row.reasonText,
    status: row.status as IntroductionOffer["status"],
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleIntroductionRepository<TResult extends PgQueryResultHKT>(
  database: NetworkDatabase<TResult>,
): IntroductionRepository {
  const repository: IntroductionRepository = {
    async transaction(work) {
      return database.transaction((transaction) => work(createDrizzleIntroductionRepository(transaction)));
    },

    async createOrGetPending(offer) {
      const sourceCharacterId = await characterId(database, offer.sourceCharacterKey, offer.sourceCharacterVersion);
      const targetCharacterId = await characterId(database, offer.targetCharacterKey, offer.targetCharacterVersion);
      await database.insert(schema.characterIntroductionOffers).values({
        userId: offer.userId,
        offerKey: offer.offerKey,
        sourceCharacterId,
        targetCharacterId,
        reasonCode: offer.reasonCode,
        reasonText: offer.reasonText,
        context: {
          sourceCharacterKey: offer.sourceCharacterKey,
          sourceCharacterVersion: offer.sourceCharacterVersion,
          targetCharacterKey: offer.targetCharacterKey,
          targetCharacterVersion: offer.targetCharacterVersion,
        },
        status: "pending",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      }).onConflictDoNothing({ target: [schema.characterIntroductionOffers.userId, schema.characterIntroductionOffers.offerKey] });
      const [row] = await database.select().from(schema.characterIntroductionOffers).where(and(
        eq(schema.characterIntroductionOffers.userId, offer.userId),
        eq(schema.characterIntroductionOffers.offerKey, offer.offerKey),
      )).limit(1);
      if (!row) throw new Error("INTRODUCTION_UNAVAILABLE");
      return toOffer(row);
    },

    async findByKey(userId, offerKey) {
      const [row] = await database.select().from(schema.characterIntroductionOffers).where(and(
        eq(schema.characterIntroductionOffers.userId, userId),
        eq(schema.characterIntroductionOffers.offerKey, offerKey),
      )).limit(1);
      return row ? toOffer(row) : null;
    },

    async listPending(userId) {
      const rows = await database.select().from(schema.characterIntroductionOffers).where(and(
        eq(schema.characterIntroductionOffers.userId, userId),
        eq(schema.characterIntroductionOffers.status, "pending"),
      )).orderBy(asc(schema.characterIntroductionOffers.createdAt));
      return rows.map(toOffer);
    },

    async resolve(userId, offerKey, status, acceptedMemoryIds = []) {
      const [row] = await database.update(schema.characterIntroductionOffers).set({
        status,
        acceptedMemoryIds: [...acceptedMemoryIds],
        resolvedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(schema.characterIntroductionOffers.userId, userId),
        eq(schema.characterIntroductionOffers.offerKey, offerKey),
        eq(schema.characterIntroductionOffers.status, "pending"),
      )).returning();
      if (row) return toOffer(row);
      const existing = await this.findByKey(userId, offerKey);
      if (!existing) throw new Error("INTRODUCTION_NOT_AVAILABLE");
      return existing;
    },

    async ensureRelationship(userId, characterKey, characterVersion) {
      const id = await characterId(database, characterKey, characterVersion);
      await database.insert(schema.characterRelationships).values({ userId, characterId: id })
        .onConflictDoNothing({ target: [schema.characterRelationships.userId, schema.characterRelationships.characterId] });
      const [row] = await database.select().from(schema.characterRelationships).where(and(
        eq(schema.characterRelationships.userId, userId),
        eq(schema.characterRelationships.characterId, id),
      )).limit(1);
      if (!row) throw new Error("RELATIONSHIP_UNAVAILABLE");
      return {
        id: row.id,
        userId: row.userId,
        characterKey,
        relationshipStage: row.relationshipStage as CharacterRelationshipRecord["relationshipStage"],
        revealedCanonFactKeys: row.revealedCanonFactKeys,
      };
    },

    async ensureConversation(userId, characterKey, characterVersion) {
      const id = await characterId(database, characterKey, characterVersion);
      await database.insert(schema.conversations).values({ userId, characterId: id })
        .onConflictDoNothing({ target: [schema.conversations.userId, schema.conversations.characterId] });
      const [conversation] = await database.select({ id: schema.conversations.id }).from(schema.conversations).where(and(
        eq(schema.conversations.userId, userId),
        eq(schema.conversations.characterId, id),
      )).limit(1);
      if (!conversation) throw new Error("CONVERSATION_UNAVAILABLE");
      return conversation.id;
    },

    async validateShareableMemories(userId, memoryIds, sourceCharacterKey) {
      if (memoryIds.length === 0) return [];
      const sourceId = await characterId(database, sourceCharacterKey, 1);
      const rows = await database.select({ id: schema.relationshipMemories.id }).from(schema.relationshipMemories).where(and(
        eq(schema.relationshipMemories.userId, userId),
        inArray(schema.relationshipMemories.id, memoryIds),
        eq(schema.relationshipMemories.characterId, sourceId),
        or(eq(schema.relationshipMemories.status, "candidate"), eq(schema.relationshipMemories.status, "confirmed")),
        or(eq(schema.relationshipMemories.sensitivity, "normal"), eq(schema.relationshipMemories.sensitivity, "sensitive")),
      ));
      return rows.map((row) => row.id);
    },

    async grantMemoryPermissions(userId, memoryIds, targetCharacterKey) {
      if (memoryIds.length === 0) return;
      const targetId = await characterId(database, targetCharacterKey, 1);
      for (const memoryId of memoryIds) {
        await database.insert(schema.memorySharingPermissions).values({
          userId,
          memoryId,
          targetCharacterId: targetId,
          isAllowed: true,
        }).onConflictDoUpdate({
          target: [schema.memorySharingPermissions.memoryId, schema.memorySharingPermissions.targetCharacterId],
          set: { isAllowed: true, grantedAt: new Date(), updatedAt: new Date() },
        });
        await database.update(schema.relationshipMemories).set({ shareScope: "explicit", updatedAt: new Date() }).where(and(
          eq(schema.relationshipMemories.id, memoryId),
          eq(schema.relationshipMemories.userId, userId),
        ));
      }
    },
  };
  return repository;
}
