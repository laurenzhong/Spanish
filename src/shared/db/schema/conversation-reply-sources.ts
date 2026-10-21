import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations, messages } from "./characters";
import { profiles } from "./users";

/** Server-owned ordered provenance for one logical reply, independent of its latest replyTo pointer. */
export const conversationReplySources = pgTable("conversation_reply_sources", {
  assistantMessageId: uuid("assistant_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userMessageId: uuid("user_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
}, (table) => [
  primaryKey({ columns: [table.assistantMessageId, table.userMessageId] }),
  uniqueIndex("conversation_reply_sources_position_uidx").on(table.assistantMessageId, table.position),
  index("conversation_reply_sources_user_message_idx").on(table.userMessageId),
  check("conversation_reply_sources_position_check", sql`${table.position} >= 0 and ${table.position} < 20`),
  check("conversation_reply_sources_distinct_check", sql`${table.assistantMessageId} <> ${table.userMessageId}`),
]);
