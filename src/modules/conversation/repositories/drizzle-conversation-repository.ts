import { aliasedTable, and, asc, desc, eq, gt, gte, ilike, inArray, isNull, notExists, or } from "drizzle-orm";
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
        .where(and(
          eq(schema.characters.stableKey, characterKey),
          eq(schema.characters.characterVersion, characterVersion),
          eq(schema.characters.status, "published"),
        ))
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
        .from(schema.conversations)
        .innerJoin(schema.characters, eq(schema.conversations.characterId, schema.characters.id))
        .where(and(
          eq(schema.conversations.id, input.conversationId),
          eq(schema.conversations.userId, input.userId),
          eq(schema.characters.stableKey, input.characterKey),
          eq(schema.characters.status, "published"),
        ))
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
      const [character] = await database
        .select({ id: schema.characters.id })
        .from(schema.conversations)
        .innerJoin(schema.characters, eq(schema.conversations.characterId, schema.characters.id))
        .where(and(
          eq(schema.conversations.id, input.conversationId),
          eq(schema.conversations.userId, input.userId),
          eq(schema.characters.stableKey, input.characterKey),
          eq(schema.characters.status, "published"),
        ))
        .limit(1);
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
        .where(and(
          eq(schema.conversations.userId, userId),
          eq(schema.characters.status, "published"),
        ))
        .orderBy(desc(schema.conversations.lastMessageAt), desc(schema.conversations.updatedAt));

      const conversationIds = rows.map(({ conversation }) => conversation.id);
      const latestMessageByConversation = new Map<string, { role: "user" | "character"; content: string; createdAt: Date }>();
      const unreadCountByConversation = new Map<string, number>();
      if (conversationIds.length > 0) {
        const withdrawnLatestParents = aliasedTable(schema.messages, "withdrawn_latest_parents");
        const messages = await database
          .selectDistinctOn([schema.messages.conversationId], {
            conversationId: schema.messages.conversationId,
            role: schema.messages.role,
            content: schema.messages.content,
            createdAt: schema.messages.createdAt,
          })
          .from(schema.messages)
          .where(and(
            inArray(schema.messages.conversationId, conversationIds),
            eq(schema.messages.status, "completed"),
            notExists(
              database.select({ id: withdrawnLatestParents.id })
                .from(withdrawnLatestParents)
                .where(and(
                  eq(withdrawnLatestParents.id, schema.messages.replyToMessageId),
                  eq(withdrawnLatestParents.userId, userId),
                  eq(withdrawnLatestParents.conversationId, schema.messages.conversationId),
                  eq(withdrawnLatestParents.status, "withdrawn"),
                )),
            ),
          ))
          .orderBy(asc(schema.messages.conversationId), desc(schema.messages.createdAt));
        for (const message of messages) {
          if (!latestMessageByConversation.has(message.conversationId)) {
            latestMessageByConversation.set(message.conversationId, {
              role: message.role === "character" ? "character" : "user",
              content: message.content,
              createdAt: message.createdAt,
            });
          }
        }
        const withdrawnUnreadParents = aliasedTable(schema.messages, "withdrawn_unread_parents");
        const unreadRows = await database
          .select({ conversationId: schema.messages.conversationId })
          .from(schema.messages)
          .leftJoin(schema.conversationPreferences, and(
            eq(schema.conversationPreferences.userId, userId),
            eq(schema.conversationPreferences.characterId, schema.messages.characterId),
          ))
          .where(and(
            inArray(schema.messages.conversationId, conversationIds),
            eq(schema.messages.role, "character"),
            eq(schema.messages.status, "completed"),
            notExists(
              database.select({ id: withdrawnUnreadParents.id })
                .from(withdrawnUnreadParents)
                .where(and(
                  eq(withdrawnUnreadParents.id, schema.messages.replyToMessageId),
                  eq(withdrawnUnreadParents.userId, userId),
                  eq(withdrawnUnreadParents.conversationId, schema.messages.conversationId),
                  eq(withdrawnUnreadParents.status, "withdrawn"),
                )),
            ),
            or(
              isNull(schema.conversationPreferences.lastReadAt),
              gt(schema.messages.createdAt, schema.conversationPreferences.lastReadAt),
            ),
          ));
        for (const row of unreadRows) unreadCountByConversation.set(row.conversationId, (unreadCountByConversation.get(row.conversationId) ?? 0) + 1);
      }

      return rows.map(({ conversation, character, conversationPreferences }) => {
        const lastMessage = latestMessageByConversation.get(conversation.id);
        return {
          conversationId: conversation.id,
          characterKey: character.stableKey,
          characterName: character.displayName,
          avatarUrl: character.avatarUrl,
          lastMessageAt: conversation.lastMessageAt,
          lastMessage: lastMessage
            ? { role: lastMessage.role, content: lastMessage.content, createdAt: lastMessage.createdAt }
            : null,
          isPinned: conversationPreferences?.isPinned ?? character.stableKey === "lucia",
          isMuted: conversationPreferences?.isMuted ?? false,
          sortRank: conversationPreferences?.sortRank ?? null,
          unreadCount: unreadCountByConversation.get(conversation.id) ?? 0,
      } satisfies ConversationListRecord;
      });
    },

    async updateConversationPreference(userId, characterKey, patch) {
      const [character] = await database
        .select({ id: schema.characters.id, stableKey: schema.characters.stableKey })
        .from(schema.characters)
        .innerJoin(schema.conversations, and(
          eq(schema.conversations.characterId, schema.characters.id),
          eq(schema.conversations.userId, userId),
        ))
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
        sortRank: patch.sortRank !== undefined ? patch.sortRank : existing?.sortRank ?? null,
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
      return { characterKey: character.stableKey, isPinned: preference.isPinned, isMuted: preference.isMuted, sortRank: preference.sortRank };
    },

    async reorderConversationPreferences(userId, characterKeys) {
      const uniqueKeys = [...new Set(characterKeys)];
      const rows = await database
        .select({ id: schema.characters.id, stableKey: schema.characters.stableKey })
        .from(schema.characters)
        .innerJoin(schema.conversations, and(
          eq(schema.conversations.characterId, schema.characters.id),
          eq(schema.conversations.userId, userId),
        ))
        .where(eq(schema.characters.status, "published"));
      const ownedKeys = new Set(rows.map((row) => row.stableKey));
      if (uniqueKeys.some((key) => !ownedKeys.has(key))) throw new Error("CONVERSATION_UNAVAILABLE");
      await database.transaction(async (transaction) => {
        for (const [sortRank, characterKey] of uniqueKeys.entries()) {
          const character = rows.find((row) => row.stableKey === characterKey);
          if (!character) continue;
          await transaction.insert(schema.conversationPreferences).values({ userId, characterId: character.id, sortRank }).onConflictDoUpdate({
            target: [schema.conversationPreferences.userId, schema.conversationPreferences.characterId],
            set: { sortRank, updatedAt: new Date() },
          });
        }
      });
    },

    async markConversationRead(userId, characterKey, readAt = new Date()) {
      const [character] = await database.select({ id: schema.characters.id }).from(schema.characters)
        .where(and(eq(schema.characters.stableKey, characterKey), eq(schema.characters.status, "published"))).limit(1);
      if (!character) throw new Error("CHARACTER_UNAVAILABLE");
      const [conversation] = await database.select({ id: schema.conversations.id }).from(schema.conversations)
        .where(and(eq(schema.conversations.userId, userId), eq(schema.conversations.characterId, character.id))).limit(1);
      if (!conversation) throw new Error("CONVERSATION_UNAVAILABLE");
      await database.insert(schema.conversationPreferences).values({ userId, characterId: character.id, lastReadAt: readAt })
        .onConflictDoUpdate({ target: [schema.conversationPreferences.userId, schema.conversationPreferences.characterId], set: { lastReadAt: readAt, updatedAt: new Date() } });
    },

    async searchMessages(userId, query, limit = 50) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) return [];
      const escapedQuery = normalizedQuery.replace(/[\\%_]/gu, (value) => `\\${value}`);
      const withdrawnSearchParents = aliasedTable(schema.messages, "withdrawn_search_parents");
      const rows = await database
        .select({ message: schema.messages, character: schema.characters })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
        .innerJoin(schema.characters, eq(schema.conversations.characterId, schema.characters.id))
        .where(and(
          eq(schema.messages.userId, userId),
          eq(schema.messages.status, "completed"),
          eq(schema.characters.status, "published"),
          notExists(
            database.select({ id: withdrawnSearchParents.id })
              .from(withdrawnSearchParents)
              .where(and(
                eq(withdrawnSearchParents.id, schema.messages.replyToMessageId),
                eq(withdrawnSearchParents.userId, userId),
                eq(withdrawnSearchParents.conversationId, schema.messages.conversationId),
                eq(withdrawnSearchParents.status, "withdrawn"),
              )),
          ),
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
      return database.transaction(async (transaction) => {
        const [message] = await transaction.select({ id: schema.messages.id, conversationId: schema.messages.conversationId })
          .from(schema.messages)
          .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
          .innerJoin(schema.characters, eq(schema.conversations.characterId, schema.characters.id))
          .where(and(
            eq(schema.messages.id, messageId),
            eq(schema.messages.userId, userId),
            eq(schema.characters.stableKey, characterKey),
            eq(schema.characters.status, "published"),
            eq(schema.messages.role, "user"),
          )).limit(1);
        if (!message) return false;

        // reply_to_message_id is intentionally not a database foreign key so
        // failed/streaming rows can be retained. Delete dependent assistant
        // content explicitly before removing the user turn, otherwise a
        // deleted prompt could survive in history/search projections.
        await transaction.delete(schema.messages).where(and(
          eq(schema.messages.userId, userId),
          eq(schema.messages.conversationId, message.conversationId),
          eq(schema.messages.replyToMessageId, message.id),
          eq(schema.messages.role, "character"),
        ));
        const deleted = await transaction.delete(schema.messages)
          .where(and(eq(schema.messages.id, message.id), eq(schema.messages.userId, userId)))
          .returning({ id: schema.messages.id });
        return deleted.length > 0;
      });
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
          eq(schema.characters.status, "published"),
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
