import { aliasedTable, and, desc, eq, notExists, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";

/**
 * One completed, non-withdrawn message from the learner's own conversation.
 *
 * The database stores the character side as `character`; the projection
 * normalizes it to `assistant` so provider adapters see the same two roles as
 * every other internal conversation type. This is a local mapping, not a
 * message-type change.
 */
export type ConversationAssistantContextMessage = Readonly<{
  role: "user" | "assistant";
  text: string;
}>;

/**
 * Read-only access for the private learning assistant. There is deliberately
 * no write port: consulting the assistant never creates a conversation,
 * message, memory or learning evidence.
 */
export type ConversationAssistantRepository = Readonly<{
  getCurrentPublishedVersion(characterKey: string): Promise<number | null>;
  listContext(
    userId: string,
    characterKey: string,
  ): Promise<readonly ConversationAssistantContextMessage[]>;
}>;

const contextMessageLimit = 8;

export function createDrizzleConversationAssistantRepository<TResult extends PgQueryResultHKT>(
  database: PgDatabase<TResult, typeof schema>,
): ConversationAssistantRepository {
  return {
    async getCurrentPublishedVersion(characterKey) {
      const [row] = await database.select({ version: schema.characters.characterVersion })
        .from(schema.characterIdentities)
        .innerJoin(schema.characters, eq(schema.characters.id, schema.characterIdentities.currentCharacterId))
        .where(and(eq(schema.characterIdentities.stableKey, characterKey), eq(schema.characters.stableKey, characterKey), eq(schema.characters.status, "published")))
        .limit(1);
      return row?.version ?? null;
    },
    async listContext(userId, characterKey) {
      const parent = aliasedTable(schema.messages, "conversation_assistant_parent");
      // Same bounded projection as expression-assist: only completed messages,
      // excluding replies whose parent turn was withdrawn, newest last.
      const rows = await database.select({ role: schema.messages.role, text: sql<string>`left(${schema.messages.content}, 2000)` })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
        .innerJoin(schema.characterIdentities, eq(schema.characterIdentities.id, schema.conversations.identityId))
        .where(and(
          eq(schema.conversations.userId, userId),
          eq(schema.messages.userId, userId),
          eq(schema.characterIdentities.stableKey, characterKey),
          eq(schema.messages.status, "completed"),
          notExists(database.select({ id: parent.id }).from(parent).where(and(
            eq(parent.id, schema.messages.replyToMessageId),
            eq(parent.userId, userId),
            eq(parent.conversationId, schema.messages.conversationId),
            eq(parent.status, "withdrawn"),
          ))),
        ))
        .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
        .limit(contextMessageLimit);
      return rows.reverse().map((row) => ({
        role: row.role === "character" ? ("assistant" as const) : ("user" as const),
        text: row.text,
      }));
    },
  };
}
