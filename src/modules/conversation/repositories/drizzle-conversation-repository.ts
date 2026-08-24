import { and, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type {
  ConversationMessageRecord,
  ConversationRepository,
} from "./conversation-repository";

type ConversationDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

function toMessage(row: typeof schema.messages.$inferSelect): ConversationMessageRecord {
  return {
    id: row.id,
    clientMessageId: row.clientMessageId,
    generationId: row.generationId,
    role: row.role === "character" ? "character" : "user",
    status: row.status,
    content: row.content,
    replyToMessageId: row.replyToMessageId,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export function createDrizzleConversationRepository<TResult extends PgQueryResultHKT>(
  database: ConversationDatabase<TResult>,
): ConversationRepository {
  return {
    async getOrCreateConversation(userId, characterKey, characterVersion) {
      const [character] = await database
        .select({ id: schema.characters.id })
        .from(schema.characters)
        .where(and(eq(schema.characters.stableKey, characterKey), eq(schema.characters.characterVersion, characterVersion)))
        .limit(1);
      if (!character) throw new Error("CHARACTER_UNAVAILABLE");

      await database
        .insert(schema.conversations)
        .values({ userId, characterId: character.id })
        .onConflictDoNothing({ target: [schema.conversations.userId, schema.conversations.characterId] });

      const [conversation] = await database
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(and(eq(schema.conversations.userId, userId), eq(schema.conversations.characterId, character.id)))
        .limit(1);
      if (!conversation) throw new Error("CONVERSATION_UNAVAILABLE");
      return conversation.id;
    },

    async appendUserMessage(input) {
      const [existing] = await database
        .select()
        .from(schema.messages)
        .where(and(eq(schema.messages.conversationId, input.conversationId), eq(schema.messages.clientMessageId, input.clientMessageId)))
        .limit(1);
      if (existing) return toMessage(existing);

      const [character] = await database
        .select({ id: schema.characters.id })
        .from(schema.characters)
        .where(and(eq(schema.characters.stableKey, input.characterKey), eq(schema.characters.characterVersion, 1)))
        .limit(1);
      if (!character) throw new Error("CHARACTER_UNAVAILABLE");
      const [message] = await database
        .insert(schema.messages)
        .values({
          userId: input.userId,
          conversationId: input.conversationId,
          characterId: character.id,
          clientMessageId: input.clientMessageId,
          generationId: input.generationId,
          role: "user",
          status: "completed",
          content: input.content,
          completedAt: new Date(),
        })
        .onConflictDoNothing({ target: [schema.messages.conversationId, schema.messages.clientMessageId] })
        .returning();
      if (message) {
        await database.update(schema.conversations).set({ lastMessageAt: message.createdAt, updatedAt: new Date() }).where(eq(schema.conversations.id, input.conversationId));
        return toMessage(message);
      }
      const [raced] = await database.select().from(schema.messages).where(and(eq(schema.messages.conversationId, input.conversationId), eq(schema.messages.clientMessageId, input.clientMessageId))).limit(1);
      if (!raced) throw new Error("MESSAGE_UNAVAILABLE");
      return toMessage(raced);
    },

    async completeAssistantMessage(input) {
      const [existing] = await database.select().from(schema.messages).where(and(
        eq(schema.messages.userId, input.userId),
        eq(schema.messages.conversationId, input.conversationId),
        eq(schema.messages.clientMessageId, input.clientMessageId),
        eq(schema.messages.role, "character"),
      )).limit(1);
      if (existing) return toMessage(existing);
      const [character] = await database.select({ id: schema.characters.id }).from(schema.characters).where(and(eq(schema.characters.stableKey, input.characterKey), eq(schema.characters.characterVersion, 1))).limit(1);
      if (!character) throw new Error("CHARACTER_UNAVAILABLE");
      const [message] = await database.insert(schema.messages).values({
        id: input.messageId,
        userId: input.userId,
        conversationId: input.conversationId,
        characterId: character.id,
        clientMessageId: input.clientMessageId,
        generationId: input.generationId,
        role: "character",
        status: "completed",
        content: input.content,
        replyToMessageId: input.replyToMessageId,
        completedAt: new Date(),
      }).onConflictDoNothing({ target: [schema.messages.conversationId, schema.messages.clientMessageId] }).returning();
      if (message) {
        await database.update(schema.conversations).set({ lastMessageAt: message.createdAt, updatedAt: new Date() }).where(eq(schema.conversations.id, input.conversationId));
        return toMessage(message);
      }
      const [raced] = await database.select().from(schema.messages).where(and(eq(schema.messages.conversationId, input.conversationId), eq(schema.messages.clientMessageId, input.clientMessageId))).limit(1);
      if (!raced) throw new Error("MESSAGE_UNAVAILABLE");
      return toMessage(raced);
    },

    async findAssistantMessage(userId, conversationId, clientMessageId) {
      const [message] = await database.select().from(schema.messages).where(and(
        eq(schema.messages.userId, userId),
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.clientMessageId, clientMessageId),
        eq(schema.messages.role, "character"),
      )).limit(1);
      return message ? toMessage(message) : null;
    },

    async listMessages(userId, characterKey, limit = 100) {
      const rows = await database.select({ message: schema.messages }).from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
        .innerJoin(schema.characters, eq(schema.conversations.characterId, schema.characters.id))
        .where(and(eq(schema.messages.userId, userId), eq(schema.characters.stableKey, characterKey)))
        .orderBy(desc(schema.messages.createdAt)).limit(Math.max(1, Math.min(limit, 200)));
      return rows.map((row) => toMessage(row.message)).reverse();
    },
  };
}
