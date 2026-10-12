import { aliasedTable, and, asc, desc, eq, gt, gte, ilike, inArray, isNull, notExists, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type {
  ConversationListRecord,
  ConversationMessageRecord,
  ConversationRepository,
} from "./conversation-repository";

type ConversationDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

/**
 * The columns a message DTO is built from. A history read returns up to 100
 * rows and is the heaviest read on the conversation page, and against a remote
 * database the transfer dominates: measured against the real endpoint, the
 * full row set costs ~2.0s while these columns cost ~1.2s (narrow faster in 7
 * of 8 paired rounds, median difference 734ms). Selecting a subset keeps
 * user_id, conversation_id, character_id and updated_at off the wire, none of
 * which the DTO exposes.
 */
const messageColumns = {
  id: schema.messages.id,
  clientMessageId: schema.messages.clientMessageId,
  generationId: schema.messages.generationId,
  role: schema.messages.role,
  status: schema.messages.status,
  content: schema.messages.content,
  replyToMessageId: schema.messages.replyToMessageId,
  createdAt: schema.messages.createdAt,
  completedAt: schema.messages.completedAt,
  sourceType: schema.messages.sourceType,
};

type MessageRow = Readonly<{
  [K in keyof typeof messageColumns]: (typeof schema.messages.$inferSelect)[K];
}>;

/**
 * Resolves a character's stable identity and the revision its pointer currently
 * names. Conversation state is keyed by `identity_id` from here on (ADR 0014);
 * the revision is only the availability gate and the dual-written audit column
 * that keeps a rollback to `character_id` possible until slice 4.
 *
 * The gate fails closed: a missing identity, or a pointer at a revision that is
 * not published, both keep raising CHARACTER_UNAVAILABLE exactly as the
 * version-keyed lookup used to.
 */
async function resolveCharacterIdentity<TResult extends PgQueryResultHKT>(
  database: ConversationDatabase<TResult>,
  characterKey: string,
): Promise<Readonly<{ identityId: string; revisionId: string }>> {
  const [row] = await database
    .select({
      identityId: schema.characterIdentities.id,
      revisionId: schema.characters.id,
      status: schema.characters.status,
    })
    .from(schema.characterIdentities)
    .innerJoin(schema.characters, eq(schema.characters.id, schema.characterIdentities.currentCharacterId))
    .where(eq(schema.characterIdentities.stableKey, characterKey))
    .limit(1);
  if (!row || row.status !== "published") throw new Error("CHARACTER_UNAVAILABLE");
  return row;
}

async function findConversationByIdentity<TResult extends PgQueryResultHKT>(
  database: ConversationDatabase<TResult>,
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

function toMessage(row: MessageRow): ConversationMessageRecord {
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
      // `characterVersion` stays in the signature for the callers that already
      // hold the catalog revision, but the conversation is no longer keyed on
      // it: the identity pointer decides which revision is current, and the
      // conversation is found through the identity.
      void characterVersion;
      const character = await resolveCharacterIdentity(database, characterKey);

      const existing = await findConversationByIdentity(database, userId, character.identityId);
      if (existing) return existing.id;

      await database
        .insert(schema.conversations)
        .values({ userId, characterId: character.revisionId, identityId: character.identityId })
        .onConflictDoNothing({ target: [schema.conversations.userId, schema.conversations.characterId] });

      const conversation = await findConversationByIdentity(database, userId, character.identityId);
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
        .select({ identityId: schema.characterIdentities.id, revisionId: schema.characters.id })
        .from(schema.conversations)
        .innerJoin(schema.characterIdentities, eq(schema.conversations.identityId, schema.characterIdentities.id))
        .innerJoin(schema.characters, eq(schema.characterIdentities.currentCharacterId, schema.characters.id))
        .where(and(
          eq(schema.conversations.id, input.conversationId),
          eq(schema.conversations.userId, input.userId),
          eq(schema.characterIdentities.stableKey, input.characterKey),
          eq(schema.characters.status, "published"),
        ))
        .limit(1);
      if (!character) throw new Error("CHARACTER_UNAVAILABLE");
      const [message] = await database
        .insert(schema.messages)
        .values({
          userId: input.userId,
          conversationId: input.conversationId,
          characterId: character.revisionId,
          identityId: character.identityId,
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
        .select({ identityId: schema.characterIdentities.id, revisionId: schema.characters.id })
        .from(schema.conversations)
        .innerJoin(schema.characterIdentities, eq(schema.conversations.identityId, schema.characterIdentities.id))
        .innerJoin(schema.characters, eq(schema.characterIdentities.currentCharacterId, schema.characters.id))
        .where(and(
          eq(schema.conversations.id, input.conversationId),
          eq(schema.conversations.userId, input.userId),
          eq(schema.characterIdentities.stableKey, input.characterKey),
          eq(schema.characters.status, "published"),
        ))
        .limit(1);
      if (!character) throw new Error("CHARACTER_UNAVAILABLE");
      const [message] = await database.insert(schema.messages).values({
        id: input.messageId,
        userId: input.userId,
        conversationId: input.conversationId,
        characterId: character.revisionId,
        identityId: character.identityId,
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
      const rows = await database.select(messageColumns).from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
        .innerJoin(schema.characterIdentities, eq(schema.conversations.identityId, schema.characterIdentities.id))
        // Filter through the owning conversation first so PostgreSQL can use
        // conversations_user_last_message_idx, then walk the conversation's
        // messages via messages_conversation_created_idx.
        .where(and(
          eq(schema.conversations.userId, userId),
          eq(schema.messages.userId, userId),
          eq(schema.characterIdentities.stableKey, characterKey),
        ))
        .orderBy(desc(schema.messages.createdAt)).limit(Math.max(1, Math.min(limit, 200)));
      return rows.map((row) => toMessage(row)).reverse();
    },

    async listConversations(userId): Promise<readonly ConversationListRecord[]> {
      // Display facts come from the revision the identity points at, not from
      // the revision the conversation was created under, so a published
      // revision never has to move the conversation row.
      const rows = await database
        .select({
          conversation: schema.conversations,
          character: schema.characters,
          conversationPreferences: schema.conversationPreferences,
        })
        .from(schema.conversations)
        .innerJoin(schema.characterIdentities, eq(schema.conversations.identityId, schema.characterIdentities.id))
        .innerJoin(schema.characters, eq(schema.characterIdentities.currentCharacterId, schema.characters.id))
        .leftJoin(schema.conversationPreferences, and(
          eq(schema.conversationPreferences.userId, userId),
          eq(schema.conversationPreferences.identityId, schema.characterIdentities.id),
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
        const withdrawnUnreadParents = aliasedTable(schema.messages, "withdrawn_unread_parents");
        // Both aggregates need only the conversation ids read above, so they
        // share one round trip instead of queueing the unread count behind the
        // latest message. The rail is on screen for every chat route.
        const [messages, unreadRows] = await Promise.all([
          database
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
            .orderBy(asc(schema.messages.conversationId), desc(schema.messages.createdAt)),
          database
            .select({ conversationId: schema.messages.conversationId })
            .from(schema.messages)
            .leftJoin(schema.conversationPreferences, and(
              eq(schema.conversationPreferences.userId, userId),
              eq(schema.conversationPreferences.identityId, schema.messages.identityId),
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
            )),
        ]);
        for (const message of messages) {
          if (!latestMessageByConversation.has(message.conversationId)) {
            latestMessageByConversation.set(message.conversationId, {
              role: message.role === "character" ? "character" : "user",
              content: message.content,
              createdAt: message.createdAt,
            });
          }
        }
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
      const character = await resolveCharacterIdentity(database, characterKey);
      const conversation = await findConversationByIdentity(database, userId, character.identityId);
      if (!conversation) throw new Error("CHARACTER_UNAVAILABLE");

      // The preference is read and written through the identity, so the row
      // survives a pointer move. `character_id` is still written on every
      // path for rollback.
      const [existing] = await database
        .select()
        .from(schema.conversationPreferences)
        .where(and(
          eq(schema.conversationPreferences.userId, userId),
          eq(schema.conversationPreferences.identityId, character.identityId),
        ))
        .limit(1);
      const values = {
        userId,
        characterId: character.revisionId,
        identityId: character.identityId,
        isPinned: patch.isPinned ?? existing?.isPinned ?? characterKey === "lucia",
        isMuted: patch.isMuted ?? existing?.isMuted ?? false,
        sortRank: patch.sortRank !== undefined ? patch.sortRank : existing?.sortRank ?? null,
        updatedAt: new Date(),
      };
      const [preference] = existing
        ? await database.update(schema.conversationPreferences).set(values).where(and(
          eq(schema.conversationPreferences.userId, userId),
          eq(schema.conversationPreferences.identityId, character.identityId),
        )).returning()
        : await database.insert(schema.conversationPreferences).values(values).onConflictDoUpdate({
          target: [schema.conversationPreferences.userId, schema.conversationPreferences.characterId],
          set: values,
        }).returning();
      if (!preference) throw new Error("CONVERSATION_PREFERENCE_UNAVAILABLE");
      return { characterKey, isPinned: preference.isPinned, isMuted: preference.isMuted, sortRank: preference.sortRank };
    },

    async reorderConversationPreferences(userId, characterKeys) {
      const uniqueKeys = [...new Set(characterKeys)];
      const rows = await database
        .select({
          identityId: schema.characterIdentities.id,
          revisionId: schema.characterIdentities.currentCharacterId,
          stableKey: schema.characterIdentities.stableKey,
        })
        .from(schema.characterIdentities)
        .innerJoin(schema.conversations, and(
          eq(schema.conversations.identityId, schema.characterIdentities.id),
          eq(schema.conversations.userId, userId),
        ))
        .innerJoin(schema.characters, eq(schema.characterIdentities.currentCharacterId, schema.characters.id))
        .where(eq(schema.characters.status, "published"));
      const ownedKeys = new Set(rows.map((row) => row.stableKey));
      if (uniqueKeys.some((key) => !ownedKeys.has(key))) throw new Error("CONVERSATION_UNAVAILABLE");
      await database.transaction(async (transaction) => {
        for (const [sortRank, characterKey] of uniqueKeys.entries()) {
          const character = rows.find((row) => row.stableKey === characterKey);
          if (!character) continue;
          // Identity first: an upsert keyed on `character_id` would insert a
          // second preference row once the pointer names a newer revision.
          // `conversation_preferences` has no surrogate key, so the identity
          // pair is what the update addresses.
          const [existing] = await transaction
            .select({ identityId: schema.conversationPreferences.identityId })
            .from(schema.conversationPreferences)
            .where(and(
              eq(schema.conversationPreferences.userId, userId),
              eq(schema.conversationPreferences.identityId, character.identityId),
            ))
            .limit(1);
          if (existing) {
            await transaction.update(schema.conversationPreferences)
              .set({ sortRank, characterId: character.revisionId, updatedAt: new Date() })
              .where(and(
                eq(schema.conversationPreferences.userId, userId),
                eq(schema.conversationPreferences.identityId, character.identityId),
              ));
            continue;
          }
          await transaction.insert(schema.conversationPreferences).values({
            userId,
            characterId: character.revisionId,
            identityId: character.identityId,
            sortRank,
          }).onConflictDoNothing({ target: [schema.conversationPreferences.userId, schema.conversationPreferences.characterId] });
        }
      });
    },

    async markConversationRead(userId, characterKey, readAt = new Date()) {
      const character = await resolveCharacterIdentity(database, characterKey);
      const conversation = await findConversationByIdentity(database, userId, character.identityId);
      if (!conversation) throw new Error("CONVERSATION_UNAVAILABLE");
      const [existing] = await database
        .select({ identityId: schema.conversationPreferences.identityId })
        .from(schema.conversationPreferences)
        .where(and(
          eq(schema.conversationPreferences.userId, userId),
          eq(schema.conversationPreferences.identityId, character.identityId),
        ))
        .limit(1);
      if (existing) {
        await database.update(schema.conversationPreferences)
          .set({ lastReadAt: readAt, characterId: character.revisionId, updatedAt: new Date() })
          .where(and(
            eq(schema.conversationPreferences.userId, userId),
            eq(schema.conversationPreferences.identityId, character.identityId),
          ));
        return;
      }
      await database.insert(schema.conversationPreferences)
        .values({ userId, characterId: character.revisionId, identityId: character.identityId, lastReadAt: readAt })
        .onConflictDoUpdate({
          target: [schema.conversationPreferences.userId, schema.conversationPreferences.characterId],
          set: { lastReadAt: readAt, updatedAt: new Date() },
        });
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
        .innerJoin(schema.characterIdentities, eq(schema.conversations.identityId, schema.characterIdentities.id))
        .innerJoin(schema.characters, eq(schema.characterIdentities.currentCharacterId, schema.characters.id))
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

    async canDeleteMessage(userId, characterKey, messageId) {
      const [message] = await database.select({ id: schema.messages.id })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
        .innerJoin(schema.characterIdentities, eq(schema.conversations.identityId, schema.characterIdentities.id))
        .where(and(
          eq(schema.messages.id, messageId),
          eq(schema.messages.userId, userId),
          eq(schema.characterIdentities.stableKey, characterKey),
          eq(schema.messages.role, "user"),
        ))
        .limit(1);
      return Boolean(message);
    },

    async deleteMessage(userId, characterKey, messageId) {
      return database.transaction(async (transaction) => {
        const [message] = await transaction.select({ id: schema.messages.id, conversationId: schema.messages.conversationId })
          .from(schema.messages)
          .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
          .innerJoin(schema.characterIdentities, eq(schema.conversations.identityId, schema.characterIdentities.id))
          .where(and(
            eq(schema.messages.id, messageId),
            eq(schema.messages.userId, userId),
            eq(schema.characterIdentities.stableKey, characterKey),
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
        .innerJoin(schema.characterIdentities, eq(schema.conversations.identityId, schema.characterIdentities.id))
        .where(and(
          eq(schema.messages.id, messageId),
          eq(schema.messages.userId, userId),
          eq(schema.characterIdentities.stableKey, characterKey),
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
