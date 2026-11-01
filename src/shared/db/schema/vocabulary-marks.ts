import { sql } from "drizzle-orm";
import { boolean, check, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { uuid } from "drizzle-orm/pg-core";
import { updatedAt } from "./common";
import { profiles } from "./users";

/** Personal intent only. Null rows prevent old browser imports reviving cleared marks. */
export const userVocabularyMarks = pgTable("user_vocabulary_marks", {
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  word: text("word").notNull(),
  status: text("status").$type<"familiar" | "learning" | "revisit" | "ignore" | null>(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.word] }),
  check("user_vocabulary_marks_word_check", sql`length(${table.word}) between 1 and 120 and ${table.word} = btrim(${table.word})`),
  check("user_vocabulary_marks_status_check", sql`${table.status} is null or ${table.status} in ('familiar', 'learning', 'revisit', 'ignore')`),
]);

/** Non-content deletion boundary: old browser backups must never undo a privacy clear. */
export const userVocabularyMarkSyncState = pgTable("user_vocabulary_mark_sync_state", {
  // SQL migration owns the auth.users FK: survive legacy profile/data clears,
  // but cascade when the real Auth account is deleted.
  userId: uuid("user_id").primaryKey(),
  legacyImportBlocked: boolean("legacy_import_blocked").default(false).notNull(),
});
