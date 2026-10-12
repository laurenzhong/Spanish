import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import {
  findCharacterRuntimeDefinition,
  isCharacterConversationEnabled,
  isPublishedCharacterStatus,
} from "@/src/modules/characters";
import type {
  LuciaContactRecord,
  LuciaContactRepository,
  LuciaContactStatus,
} from "./lucia-contact-repository";

type NetworkDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

const source = {
  kind: "cultural-event" as const,
  city: "Madrid" as const,
  topic: "urban-photography" as const,
};

const authoredOpening = {
  clientMessageId: "lucia-authored-opening-v1",
  generationId: "lucia-authored-opening-v1",
  content: "En la historia ficticia de Lucía, aquella conversación sobre fotografía urbana se quedó como un recuerdo bonito. Me dio curiosidad seguir hablando contigo por aquí.",
};

/**
 * Lucía's stable identity plus the revision its pointer currently names.
 *
 * The pointer is the only revision this gate depends on. Her relationship row
 * and her conversation are user state, so they are read through `identity_id`;
 * a new bible revision therefore no longer has to move them, and a relationship
 * row stranded on a superseded revision is still found (ADR 0014). Everything
 * user state carries is still dual-written on `character_id` for rollback.
 *
 * The gate fails closed: a missing identity, a pointer at a revision that is
 * not published, or a pointer at a revision without a published conversation
 * definition all surface as CHARACTER_UNAVAILABLE. That is the same error the
 * callers already answer with CONTACT_REQUIRED/CHARACTER_UNAVAILABLE.
 */
async function findLucia<TResult extends PgQueryResultHKT>(database: NetworkDatabase<TResult>) {
  const [character] = await database
    .select({
      identityId: schema.characterIdentities.id,
      revisionId: schema.characters.id,
      version: schema.characters.characterVersion,
      status: schema.characters.status,
    })
    .from(schema.characterIdentities)
    .innerJoin(schema.characters, eq(schema.characters.id, schema.characterIdentities.currentCharacterId))
    .where(eq(schema.characterIdentities.stableKey, "lucia"))
    .limit(1);
  const definition = character ? findCharacterRuntimeDefinition("lucia", character.version) : null;
  if (!character || !isPublishedCharacterStatus(character.status) || !isCharacterConversationEnabled(definition)) {
    throw new Error("CHARACTER_UNAVAILABLE");
  }
  return character;
}

/**
 * Finds Lucía's conversation for this user through the identity, so the lookup
 * does not depend on which revision the row was created under. Falls back to
 * nothing when the identity is unknown.
 */
async function findLuciaConversation<TResult extends PgQueryResultHKT>(
  database: NetworkDatabase<TResult>,
  userId: string,
  identityId: string,
): Promise<{ id: string } | null> {
  const [conversation] = await database
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.userId, userId), eq(schema.conversations.identityId, identityId)))
    .limit(1);
  return conversation ?? null;
}

/**
 * Creates the conversation only when the identity has none. Checking the
 * identity first keeps this idempotent after the pointer moves to a new
 * revision, where an upsert keyed on `character_id` would insert a second row.
 */
async function ensureLuciaConversation<TResult extends PgQueryResultHKT>(
  database: NetworkDatabase<TResult>,
  userId: string,
  character: Readonly<{ identityId: string; revisionId: string }>,
): Promise<void> {
  if (await findLuciaConversation(database, userId, character.identityId)) return;
  await database.insert(schema.conversations)
    .values({ userId, characterId: character.revisionId, identityId: character.identityId })
    .onConflictDoNothing({ target: [schema.conversations.userId, schema.conversations.characterId] });
}

export function createDrizzleLuciaContactRepository<TResult extends PgQueryResultHKT>(
  database: NetworkDatabase<TResult>,
): LuciaContactRepository {
  const repository: LuciaContactRepository = {
    async transaction(work) {
      return database.transaction((transaction) => work(createDrizzleLuciaContactRepository(transaction)));
    },

    async get(userId) {
      // The guard, the relationship and the conversation are resolved in one
      // statement. A remote database bills the request in round trips rather
      // than query cost, and this branch runs on every conversation open and
      // every send. The statement now starts from the identity instead of the
      // v1 revision row: both joined tables are user state and are matched on
      // `identity_id`, so they are found no matter which revision created them
      // (on the live database Lucía's relationship still sits on v1 while her
      // conversation sits on v2 - the old shape silently reported a null
      // conversation and would have created a duplicate on the next accept).
      const [row] = await database
        .select({
          relationshipId: schema.characterRelationships.id,
          relationshipStatus: schema.characterRelationships.status,
          relationshipStage: schema.characterRelationships.relationshipStage,
          relationshipSummary: schema.characterRelationships.relationshipSummary,
          conversationId: schema.conversations.id,
          characterVersion: schema.characters.characterVersion,
          characterStatus: schema.characters.status,
        })
        .from(schema.characterIdentities)
        .innerJoin(schema.characters, eq(schema.characters.id, schema.characterIdentities.currentCharacterId))
        .leftJoin(schema.characterRelationships, and(
          eq(schema.characterRelationships.identityId, schema.characterIdentities.id),
          eq(schema.characterRelationships.userId, userId),
        ))
        .leftJoin(schema.conversations, and(
          eq(schema.conversations.identityId, schema.characterIdentities.id),
          eq(schema.conversations.userId, userId),
        ))
        .where(eq(schema.characterIdentities.stableKey, "lucia"))
        .limit(1);
      const definition = row ? findCharacterRuntimeDefinition("lucia", row.characterVersion) : null;
      if (!row || !isPublishedCharacterStatus(row.characterStatus) || !isCharacterConversationEnabled(definition)) {
        throw new Error("CHARACTER_UNAVAILABLE");
      }
      const relationship = row.relationshipId === null ? null : row;
      const conversation = row.conversationId === null ? null : { id: row.conversationId };
      // Preserve conversations created before the friend-request gate existed.
      // They are already an established contact and must not be hidden.
      if (!relationship) {
        return {
          characterKey: "lucia",
          status: conversation ? "active" : "pending",
          relationshipStage: "new_contact",
          relationshipSummary: null,
          conversationId: conversation?.id ?? null,
          source,
        };
      }
      return {
        characterKey: "lucia",
        status: relationship.relationshipStatus as LuciaContactStatus,
        relationshipStage: relationship.relationshipStage as LuciaContactRecord["relationshipStage"],
        relationshipSummary: relationship.relationshipSummary?.es ?? null,
        conversationId: conversation?.id ?? null,
        source,
      };
    },

    async respond(userId, decision) {
      const character = await findLucia(database);
      const current = await this.get(userId);
      if (current.status === "active") {
        if (decision === "accept" && !current.conversationId) {
          await ensureLuciaConversation(database, userId, character);
          await repository.ensureAuthoredOpeningMessage(userId);
          return this.get(userId);
        }
        if (decision === "accept") await repository.ensureAuthoredOpeningMessage(userId);
        return current;
      }
      if (current.status === "declined" && decision === "decline") return current;

      if (current.status === "declined" && decision === "accept") {
        // Matched on the identity: the stored row may still carry the revision
        // id it was created under, and an update keyed on `character_id` would
        // silently match nothing and leave the contact declined.
        await database.update(schema.characterRelationships)
          .set({ status: "active", updatedAt: new Date() })
          .where(and(
            eq(schema.characterRelationships.userId, userId),
            eq(schema.characterRelationships.identityId, character.identityId),
          ));
      } else if (current.status === "pending") {
        const status = decision === "accept" ? "active" : "declined";
        const updated = await database.update(schema.characterRelationships)
          .set({ status, updatedAt: new Date() })
          .where(and(
            eq(schema.characterRelationships.userId, userId),
            eq(schema.characterRelationships.identityId, character.identityId),
          ))
          .returning({ id: schema.characterRelationships.id });
        if (updated.length === 0) {
          await database.insert(schema.characterRelationships)
            .values({
              userId,
              characterId: character.revisionId,
              identityId: character.identityId,
              status,
              relationshipStage: "new_contact",
            })
            .onConflictDoNothing({ target: [schema.characterRelationships.userId, schema.characterRelationships.characterId] });
        }
      }

      if (decision === "accept") {
        await ensureLuciaConversation(database, userId, character);
        await repository.ensureAuthoredOpeningMessage(userId);
      }
      return this.get(userId);
    },

    async ensureAuthoredOpeningMessage(userId) {
      const character = await findLucia(database);
      const conversation = await findLuciaConversation(database, userId, character.identityId);
      if (!conversation) throw new Error("CONVERSATION_UNAVAILABLE");
      const [existing] = await database
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(and(eq(schema.messages.conversationId, conversation.id), eq(schema.messages.clientMessageId, authoredOpening.clientMessageId)))
        .limit(1);
      if (existing) return;
      const [message] = await database.insert(schema.messages).values({
        id: randomUUID(),
        userId,
        conversationId: conversation.id,
        characterId: character.revisionId,
        identityId: character.identityId,
        clientMessageId: authoredOpening.clientMessageId,
        generationId: authoredOpening.generationId,
        role: "character",
        status: "completed",
        sourceType: "authored_opening",
        content: authoredOpening.content,
        completedAt: new Date(),
      }).onConflictDoNothing({ target: [schema.messages.conversationId, schema.messages.clientMessageId] }).returning({ id: schema.messages.id, createdAt: schema.messages.createdAt });
      if (message) {
        await database.update(schema.conversations).set({ lastMessageAt: message.createdAt, updatedAt: new Date() }).where(eq(schema.conversations.id, conversation.id));
      }
    },
  };
  return repository;
}
