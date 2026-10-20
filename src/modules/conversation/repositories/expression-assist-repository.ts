import { aliasedTable, and, desc, eq, notExists, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";

export type ExpressionAssistContext = Readonly<{ role: "user" | "assistant"; text: string }>;
export type ExpressionAssistRepository = Readonly<{
  getCurrentPublishedVersion(characterKey: string): Promise<number | null>;
  listContext(userId: string, characterKey: string): Promise<readonly ExpressionAssistContext[]>;
}>;

/** Read-only projection; never creates a conversation for an assistance draft. */
export function createDrizzleExpressionAssistRepository<TResult extends PgQueryResultHKT>(
  database: PgDatabase<TResult, typeof schema>,
): ExpressionAssistRepository {
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
      const parent = aliasedTable(schema.messages, "expression_assist_parent");
      const rows = await database.select({ role: schema.messages.role, text: sql<string>`left(${schema.messages.content}, 2000)` })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
        .innerJoin(schema.characterIdentities, eq(schema.characterIdentities.id, schema.conversations.identityId))
        .where(and(
          eq(schema.conversations.userId, userId), eq(schema.messages.userId, userId),
          eq(schema.characterIdentities.stableKey, characterKey), eq(schema.messages.status, "completed"),
          notExists(database.select({ id: parent.id }).from(parent).where(and(
            eq(parent.id, schema.messages.replyToMessageId), eq(parent.userId, userId),
            eq(parent.conversationId, schema.messages.conversationId), eq(parent.status, "withdrawn"),
          ))),
        ))
        .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id)).limit(6);
      return rows.reverse().map((row) => ({ role: row.role === "character" ? "assistant" : "user", text: row.text }));
    },
  };
}
