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

async function findLucia<TResult extends PgQueryResultHKT>(database: NetworkDatabase<TResult>) {
  const [character] = await database
    .select({ id: schema.characters.id, status: schema.characters.status })
    .from(schema.characters)
    .where(and(eq(schema.characters.stableKey, "lucia"), eq(schema.characters.characterVersion, 1)))
    .limit(1);
  const definition = findCharacterRuntimeDefinition("lucia", 1);
  if (!character || !isPublishedCharacterStatus(character.status) || !isCharacterConversationEnabled(definition)) {
    throw new Error("CHARACTER_UNAVAILABLE");
  }
  return character;
}

export function createDrizzleLuciaContactRepository<TResult extends PgQueryResultHKT>(
  database: NetworkDatabase<TResult>,
): LuciaContactRepository {
  const repository: LuciaContactRepository = {
    async transaction(work) {
      return database.transaction((transaction) => work(createDrizzleLuciaContactRepository(transaction)));
    },

    async get(userId) {
      const character = await findLucia(database);
      const [relationship] = await database
        .select({ id: schema.characterRelationships.id, status: schema.characterRelationships.status, relationshipStage: schema.characterRelationships.relationshipStage, relationshipSummary: schema.characterRelationships.relationshipSummary })
        .from(schema.characterRelationships)
        .where(and(eq(schema.characterRelationships.userId, userId), eq(schema.characterRelationships.characterId, character.id)))
        .limit(1);
      const [conversation] = await database
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(and(eq(schema.conversations.userId, userId), eq(schema.conversations.characterId, character.id)))
        .limit(1);
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
        status: relationship.status as LuciaContactStatus,
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
          await database.insert(schema.conversations)
            .values({ userId, characterId: character.id })
            .onConflictDoNothing({ target: [schema.conversations.userId, schema.conversations.characterId] });
          await repository.ensureAuthoredOpeningMessage(userId);
          return this.get(userId);
        }
        if (decision === "accept") await repository.ensureAuthoredOpeningMessage(userId);
        return current;
      }
      if (current.status === "declined" && decision === "decline") return current;

      if (current.status === "declined" && decision === "accept") {
        await database.update(schema.characterRelationships)
          .set({ status: "active", updatedAt: new Date() })
          .where(and(eq(schema.characterRelationships.userId, userId), eq(schema.characterRelationships.characterId, character.id)));
      } else if (current.status === "pending") {
        await database.insert(schema.characterRelationships)
          .values({ userId, characterId: character.id, status: decision === "accept" ? "active" : "declined", relationshipStage: "new_contact" })
          .onConflictDoUpdate({
            target: [schema.characterRelationships.userId, schema.characterRelationships.characterId],
            set: { status: decision === "accept" ? "active" : "declined", updatedAt: new Date() },
          });
      }

      if (decision === "accept") {
        await database.insert(schema.conversations)
          .values({ userId, characterId: character.id })
          .onConflictDoNothing({ target: [schema.conversations.userId, schema.conversations.characterId] });
        await repository.ensureAuthoredOpeningMessage(userId);
      }
      return this.get(userId);
    },

    async ensureAuthoredOpeningMessage(userId) {
      const character = await findLucia(database);
      const [conversation] = await database
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(and(eq(schema.conversations.userId, userId), eq(schema.conversations.characterId, character.id)))
        .limit(1);
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
        characterId: character.id,
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
