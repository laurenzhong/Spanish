import { aliasedTable, and, asc, eq, inArray, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import {
  findCharacterRuntimeDefinition,
  isCharacterConversationEnabled,
  isPublishedCharacterStatus,
} from "@/src/modules/characters";
import type { IntroductionOffer } from "../domain";
import type {
  CharacterRelationshipRecord,
  IntroductionRecord,
  IntroductionRepository,
  ShareableMemoryPreview,
} from "./introduction-repository";

type NetworkDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

/**
 * Resolves a character's stable identity plus the revision its pointer names.
 *
 * Everything the user owns - relationships, conversations, memories, sharing
 * permissions, offers - is keyed by `identity_id`, so a new bible revision no
 * longer has to move it (ADR 0014). The revision is only the availability gate
 * and the dual-written `character_id` that keeps rollback possible; it is read
 * from the identity pointer, never from the caller's version argument.
 *
 * The gate fails closed: a missing identity, or a pointer at an unpublished or
 * conversation-disabled revision, raises CHARACTER_UNAVAILABLE.
 */
async function characterIdentity<TResult extends PgQueryResultHKT>(
  database: NetworkDatabase<TResult>,
  characterKey: string,
  capability: "conversation" | "introductions" = "conversation",
): Promise<Readonly<{ identityId: string; revisionId: string; version: number }>> {
  const [character] = await database
    .select({
      identityId: schema.characterIdentities.id,
      revisionId: schema.characters.id,
      version: schema.characters.characterVersion,
      status: schema.characters.status,
    })
    .from(schema.characterIdentities)
    .innerJoin(schema.characters, eq(schema.characters.id, schema.characterIdentities.currentCharacterId))
    .where(eq(schema.characterIdentities.stableKey, characterKey))
    .limit(1);
  const definition = character ? findCharacterRuntimeDefinition(characterKey, character.version) : null;
  const manifestReady = definition && (definition.lifecycle === "published" || process.env.NODE_ENV === "test");
  if (!character || !isPublishedCharacterStatus(character.status) || !manifestReady || definition?.policy.conversation === "disabled") {
    throw new Error("CHARACTER_UNAVAILABLE");
  }
  if (capability === "introductions" && !definition?.policy.introductions) {
    throw new Error("CHARACTER_UNAVAILABLE");
  }
  return character;
}

/**
 * Revocation is an owner-controlled privacy operation. It must remain
 * available even after a target character is retired or moved back to draft;
 * only creation/sharing is gated by the published runtime policy.
 */
async function permissionTargetIdentity<TResult extends PgQueryResultHKT>(
  database: NetworkDatabase<TResult>,
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
 * Grants (or re-grants) one memory permission for a target identity.
 *
 * `memory_sharing_permissions` is unique per (memory, revision), so an upsert
 * keyed on the revision would insert a second grant once the pointer moves to a
 * newer one. The identity pair is checked first for that reason.
 */
async function grantMemoryPermission<TResult extends PgQueryResultHKT>(
  database: NetworkDatabase<TResult>,
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
      .set({ isAllowed: true, grantedAt: now, updatedAt: now })
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
      const source = await characterIdentity(database, offer.sourceCharacterKey, "introductions");
      const target = await characterIdentity(database, offer.targetCharacterKey);
      await database.insert(schema.characterIntroductionOffers).values({
        userId: offer.userId,
        offerKey: offer.offerKey,
        sourceCharacterId: source.revisionId,
        targetCharacterId: target.revisionId,
        sourceIdentityId: source.identityId,
        targetIdentityId: target.identityId,
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

    async getRelationshipStatus(userId, characterKey, characterVersion) {
      // The gate answers two questions - is this character published, and what
      // is this user's relationship with it - and one statement answers both.
      // They used to be two sequential round trips, which a remote database
      // bills to every non-Lucía history read and send; this is the merged
      // shape the Lucía contact gate already uses.
      //
      // The relationship is now joined on `identity_id`, and the published
      // check reads the revision the identity points at. The caller's
      // `characterVersion` no longer selects the user-state row: it was a
      // hardcoded literal at both call sites, so a newer revision would have
      // made this gate report "pending" against a relationship that exists.
      void characterVersion;
      const [row] = await database
        .select({
          characterVersion: schema.characters.characterVersion,
          characterStatus: schema.characters.status,
          relationshipStatus: schema.characterRelationships.status,
        })
        .from(schema.characterIdentities)
        .innerJoin(schema.characters, eq(schema.characters.id, schema.characterIdentities.currentCharacterId))
        .leftJoin(schema.characterRelationships, and(
          eq(schema.characterRelationships.identityId, schema.characterIdentities.id),
          eq(schema.characterRelationships.userId, userId),
        ))
        .where(eq(schema.characterIdentities.stableKey, characterKey))
        .limit(1);
      const definition = row ? findCharacterRuntimeDefinition(characterKey, row.characterVersion) : null;
      if (!row || !isPublishedCharacterStatus(row.characterStatus) || !isCharacterConversationEnabled(definition)) return null;
      return (row.relationshipStatus as "active" | "declined" | "pending" | null) ?? null;
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
      void characterVersion;
      const character = await characterIdentity(database, characterKey);
      // Identity first: inserting keyed on the caller's revision would insert a
      // second relationship row once the identity points at a newer revision.
      let [row] = await database.select().from(schema.characterRelationships).where(and(
        eq(schema.characterRelationships.userId, userId),
        eq(schema.characterRelationships.identityId, character.identityId),
      )).limit(1);
      if (!row) {
        await database.insert(schema.characterRelationships).values({
          userId,
          characterId: character.revisionId,
          identityId: character.identityId,
        }).onConflictDoNothing({ target: [schema.characterRelationships.userId, schema.characterRelationships.characterId] });
        [row] = await database.select().from(schema.characterRelationships).where(and(
          eq(schema.characterRelationships.userId, userId),
          eq(schema.characterRelationships.identityId, character.identityId),
        )).limit(1);
      }
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
      void characterVersion;
      const character = await characterIdentity(database, characterKey);
      const findConversation = async () => {
        const [conversation] = await database.select({ id: schema.conversations.id }).from(schema.conversations).where(and(
          eq(schema.conversations.userId, userId),
          eq(schema.conversations.identityId, character.identityId),
        )).limit(1);
        return conversation ?? null;
      };
      const existing = await findConversation();
      if (existing) return existing.id;
      await database.insert(schema.conversations).values({
        userId,
        characterId: character.revisionId,
        identityId: character.identityId,
      }).onConflictDoNothing({ target: [schema.conversations.userId, schema.conversations.characterId] });
      const conversation = await findConversation();
      if (!conversation) throw new Error("CONVERSATION_UNAVAILABLE");
      return conversation.id;
    },

    async validateShareableMemories(userId, memoryIds, sourceCharacterKey, sourceCharacterVersion = 1) {
      void sourceCharacterVersion;
      const source = await characterIdentity(database, sourceCharacterKey);
      if (memoryIds.length === 0) return [];
      const rows = await database.select({ id: schema.relationshipMemories.id }).from(schema.relationshipMemories).where(and(
        eq(schema.relationshipMemories.userId, userId),
        inArray(schema.relationshipMemories.id, memoryIds),
        eq(schema.relationshipMemories.identityId, source.identityId),
        or(eq(schema.relationshipMemories.status, "candidate"), eq(schema.relationshipMemories.status, "confirmed")),
        or(eq(schema.relationshipMemories.sensitivity, "normal"), eq(schema.relationshipMemories.sensitivity, "sensitive")),
      ));
      return rows.map((row) => row.id);
    },

    async grantMemoryPermissions(userId, memoryIds, targetCharacterKey, targetCharacterVersion = 1) {
      if (memoryIds.length === 0) return;
      void targetCharacterVersion;
      const target = await characterIdentity(database, targetCharacterKey);
      for (const memoryId of memoryIds) {
        await grantMemoryPermission(database, {
          userId,
          memoryId,
          targetIdentityId: target.identityId,
          targetCharacterId: target.revisionId,
        });
        await database.update(schema.relationshipMemories).set({ shareScope: "explicit", updatedAt: new Date() }).where(and(
          eq(schema.relationshipMemories.id, memoryId),
          eq(schema.relationshipMemories.userId, userId),
        ));
      }
    },

    async listShareableMemoryPreviews(userId, sourceCharacterKey, targetCharacterKey, sourceCharacterVersion = 1, targetCharacterVersion = 1): Promise<readonly ShareableMemoryPreview[]> {
      void sourceCharacterVersion;
      void targetCharacterVersion;
      const source = await characterIdentity(database, sourceCharacterKey);
      const target = await characterIdentity(database, targetCharacterKey);
      const rows = await database
        .select({
          id: schema.relationshipMemories.id,
          characterKey: schema.characterIdentities.stableKey,
          category: schema.relationshipMemories.category,
          content: schema.relationshipMemories.content,
          sensitivity: schema.relationshipMemories.sensitivity,
          alreadyShared: schema.memorySharingPermissions.isAllowed,
        })
        .from(schema.relationshipMemories)
        .innerJoin(schema.characterIdentities, eq(schema.relationshipMemories.identityId, schema.characterIdentities.id))
        .leftJoin(schema.memorySharingPermissions, and(
          eq(schema.memorySharingPermissions.memoryId, schema.relationshipMemories.id),
          eq(schema.memorySharingPermissions.userId, userId),
          eq(schema.memorySharingPermissions.targetIdentityId, target.identityId),
        ))
        .where(and(
          eq(schema.relationshipMemories.userId, userId),
          eq(schema.relationshipMemories.identityId, source.identityId),
          or(eq(schema.relationshipMemories.status, "candidate"), eq(schema.relationshipMemories.status, "confirmed")),
          or(eq(schema.relationshipMemories.sensitivity, "normal"), eq(schema.relationshipMemories.sensitivity, "sensitive")),
        ))
        .orderBy(asc(schema.relationshipMemories.createdAt));
      return rows.map((row) => ({
        id: row.id,
        characterKey: row.characterKey,
        category: row.category,
        content: row.content,
        sensitivity: row.sensitivity as ShareableMemoryPreview["sensitivity"],
        alreadyShared: row.alreadyShared === true,
      }));
    },

    async listGrantedMemoryPreviews(userId): Promise<readonly ShareableMemoryPreview[]> {
      const sourceIdentities = aliasedTable(schema.characterIdentities, "shared_memory_source_identities");
      const targetIdentities = aliasedTable(schema.characterIdentities, "shared_memory_target_identities");
      const rows = await database
        .select({
          id: schema.relationshipMemories.id,
          characterKey: sourceIdentities.stableKey,
          category: schema.relationshipMemories.category,
          content: schema.relationshipMemories.content,
          sensitivity: schema.relationshipMemories.sensitivity,
          alreadyShared: schema.memorySharingPermissions.isAllowed,
          targetCharacterKey: targetIdentities.stableKey,
        })
        .from(schema.relationshipMemories)
        .innerJoin(schema.memorySharingPermissions, and(
          eq(schema.memorySharingPermissions.memoryId, schema.relationshipMemories.id),
          eq(schema.memorySharingPermissions.userId, userId),
          eq(schema.memorySharingPermissions.isAllowed, true),
        ))
        .innerJoin(sourceIdentities, eq(schema.relationshipMemories.identityId, sourceIdentities.id))
        .innerJoin(targetIdentities, eq(schema.memorySharingPermissions.targetIdentityId, targetIdentities.id))
        .where(and(
          eq(schema.relationshipMemories.userId, userId),
          or(eq(schema.relationshipMemories.status, "candidate"), eq(schema.relationshipMemories.status, "confirmed")),
          or(eq(schema.relationshipMemories.sensitivity, "normal"), eq(schema.relationshipMemories.sensitivity, "sensitive")),
        ))
        .orderBy(asc(schema.relationshipMemories.createdAt));
      return rows.map((row) => ({
        id: row.id,
        characterKey: row.characterKey,
        targetCharacterKey: row.targetCharacterKey,
        category: row.category,
        content: row.content,
        sensitivity: row.sensitivity as ShareableMemoryPreview["sensitivity"],
        alreadyShared: row.alreadyShared === true,
      }));
    },

    async revokeMemoryPermission(userId, memoryId, targetCharacterKey, targetCharacterVersion = 1) {
      void targetCharacterVersion;
      const target = await permissionTargetIdentity(database, targetCharacterKey);
      await database.update(schema.memorySharingPermissions).set({
        isAllowed: false,
        updatedAt: new Date(),
      }).where(and(
        eq(schema.memorySharingPermissions.userId, userId),
        eq(schema.memorySharingPermissions.memoryId, memoryId),
        eq(schema.memorySharingPermissions.targetIdentityId, target.identityId),
      ));
      const [activePermission] = await database.select({ id: schema.memorySharingPermissions.id }).from(schema.memorySharingPermissions).where(and(
        eq(schema.memorySharingPermissions.userId, userId),
        eq(schema.memorySharingPermissions.memoryId, memoryId),
        eq(schema.memorySharingPermissions.isAllowed, true),
      )).limit(1);
      if (!activePermission) {
        await database.update(schema.relationshipMemories).set({ shareScope: "private", updatedAt: new Date() }).where(and(
          eq(schema.relationshipMemories.userId, userId),
          eq(schema.relationshipMemories.id, memoryId),
        ));
      }
    },
  };
  return repository;
}
