import { and, desc, eq, gte, ilike } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type {
  ConversationListRecord,
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
    sourceType: row.sourceType,
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
          sourceType: "conversation",
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
        sourceType: "conversation",
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
        // Filter through the owning conversation first so PostgreSQL can use
        // conversations_user_character_uidx, then walk the conversation's
        // messages via messages_conversation_created_idx.
        .where(and(
          eq(schema.conversations.userId, userId),
          eq(schema.messages.userId, userId),
          eq(schema.characters.stableKey, characterKey),
        ))
        .orderBy(desc(schema.messages.createdAt)).limit(Math.max(1, Math.min(limit, 200)));
      return rows.map((row) => toMessage(row.message)).reverse();
    },

    async listConversations(userId): Promise<readonly ConversationListRecord[]> {
      const rows = await database
        .select({
          conversation: schema.conversations,
          character: schema.characters,
          conversationPreferences: schema.conversationPreferences,
        })
        .from(schema.conversations)
        .innerJoin(schema.characters, eq(schema.conversations.characterId, schema.characters.id))
        .leftJoin(schema.conversationPreferences, and(
          eq(schema.conversationPreferences.userId, userId),
          eq(schema.conversationPreferences.characterId, schema.characters.id),
        ))
        .where(eq(schema.conversations.userId, userId))
        .orderBy(desc(schema.conversations.lastMessageAt), desc(schema.conversations.updatedAt));

      return Promise.all(rows.map(async ({ conversation, character, conversationPreferences }) => {
        const [lastMessage] = await database
          .select({
            role: schema.messages.role,
            content: schema.messages.content,
            createdAt: schema.messages.createdAt,
          })
          .from(schema.messages)
          .where(and(eq(schema.messages.conversationId, conversation.id), eq(schema.messages.status, "completed")))
          .orderBy(desc(schema.messages.createdAt))
          .limit(1);
        return {
          conversationId: conversation.id,
          characterKey: character.stableKey,
          characterName: character.displayName,
          avatarUrl: character.avatarUrl,
          lastMessageAt: conversation.lastMessageAt,
          lastMessage: lastMessage
            ? { role: lastMessage.role === "character" ? "character" : "user", content: lastMessage.content, createdAt: lastMessage.createdAt }
            : null,
          isPinned: conversationPreferences?.isPinned ?? character.stableKey === "lucia",
          isMuted: conversationPreferences?.isMuted ?? false,
        } satisfies ConversationListRecord;
      }));
    },

    async updateConversationPreference(userId, characterKey, patch) {
      const [character] = await database
        .select({ id: schema.characters.id, stableKey: schema.characters.stableKey })
        .from(schema.characters)
        .where(and(eq(schema.characters.stableKey, characterKey), eq(schema.characters.status, "published")))
        .limit(1);
      if (!character) throw new Error("CHARACTER_UNAVAILABLE");

      const [existing] = await database
        .select()
        .from(schema.conversationPreferences)
        .where(and(
          eq(schema.conversationPreferences.userId, userId),
          eq(schema.conversationPreferences.characterId, character.id),
        ))
        .limit(1);
      const values = {
        userId,
        characterId: character.id,
        isPinned: patch.isPinned ?? existing?.isPinned ?? character.stableKey === "lucia",
        isMuted: patch.isMuted ?? existing?.isMuted ?? false,
        updatedAt: new Date(),
      };
      const [preference] = existing
        ? await database.update(schema.conversationPreferences).set(values).where(and(
          eq(schema.conversationPreferences.userId, userId),
          eq(schema.conversationPreferences.characterId, character.id),
        )).returning()
        : await database.insert(schema.conversationPreferences).values(values).onConflictDoUpdate({
          target: [schema.conversationPreferences.userId, schema.conversationPreferences.characterId],
          set: values,
        }).returning();
      if (!preference) throw new Error("CONVERSATION_PREFERENCE_UNAVAILABLE");
      return { characterKey: character.stableKey, isPinned: preference.isPinned, isMuted: preference.isMuted };
    },

    async searchMessages(userId, query, limit = 50) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) return [];
      const escapedQuery = normalizedQuery.replace(/[\\%_]/gu, (value) => `\\${value}`);
      const rows = await database
        .select({ message: schema.messages, character: schema.characters })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
        .innerJoin(schema.characters, eq(schema.conversations.characterId, schema.characters.id))
        .where(and(
          eq(schema.messages.userId, userId),
          eq(schema.messages.status, "completed"),
          ilike(schema.messages.content, `%${escapedQuery}%`),
        ))
        .orderBy(desc(schema.messages.createdAt))
        .limit(Math.max(1, Math.min(limit, 50)));
      return rows.map((row) => ({
        ...toMessage(row.message),
        characterKey: row.character.stableKey,
        characterName: row.character.displayName,
      }));
    },

    async deleteMessage(userId, characterKey, messageId) {
      const [message] = await database.select({ id: schema.messages.id })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
        .innerJoin(schema.characters, eq(schema.conversations.characterId, schema.characters.id))
        .where(and(
          eq(schema.messages.id, messageId),
          eq(schema.messages.userId, userId),
          eq(schema.characters.stableKey, characterKey),
          eq(schema.messages.role, "user"),
        )).limit(1);
      if (!message) return false;
      const deleted = await database.delete(schema.messages)
        .where(and(eq(schema.messages.id, message.id), eq(schema.messages.userId, userId)))
        .returning({ id: schema.messages.id });
      return deleted.length > 0;
    },

    async withdrawMessage(userId, characterKey, messageId) {
      const cutoff = new Date(Date.now() - 2 * 60 * 1000);
      const [message] = await database.select({ id: schema.messages.id })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
        .innerJoin(schema.characters, eq(schema.conversations.characterId, schema.characters.id))
        .where(and(
          eq(schema.messages.id, messageId),
          eq(schema.messages.userId, userId),
          eq(schema.characters.stableKey, characterKey),
          eq(schema.messages.role, "user"),
          eq(schema.messages.status, "completed"),
          gte(schema.messages.createdAt, cutoff),
        )).limit(1);
      if (!message) return false;
      const updated = await database.update(schema.messages)
        .set({ status: "withdrawn", updatedAt: new Date() })
        .where(and(eq(schema.messages.id, message.id), eq(schema.messages.userId, userId)))
        .returning({ id: schema.messages.id });
      return updated.length > 0;
    },

    async isMessageWithdrawn(userId, messageId) {
      const [message] = await database.select({ status: schema.messages.status })
        .from(schema.messages)
        .where(and(eq(schema.messages.userId, userId), eq(schema.messages.id, messageId)))
        .limit(1);
      return message?.status === "withdrawn";
    },
  };
}
