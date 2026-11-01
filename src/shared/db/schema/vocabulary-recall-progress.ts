import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { profiles } from "./users";
import { createdAt, updatedAt } from "./common";

export const userVocabularyRecallProgress = pgTable("user_vocabulary_recall_progress", {
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  word: text("word").notNull(),
  mode: text("mode").$type<"word" | "meaning">().notNull(),
  stage: text("stage").$type<"learning" | "review">().notNull(),
  revision: integer("revision").notNull(),
  successfulReviews: integer("successful_reviews").notNull(),
  nextReviewAt: timestamp("next_review_at", { withTimezone: true, mode: "date" }),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.word, table.mode] }),
  check("vocabulary_recall_word_check", sql`length(${table.word}) between 1 and 120 and ${table.word} = btrim(${table.word})`),
  check("vocabulary_recall_mode_check", sql`${table.mode} in ('word', 'meaning')`),
  check("vocabulary_recall_revision_check", sql`${table.revision} >= 1`),
  check("vocabulary_recall_stage_check", sql`(${table.stage} = 'learning' and ${table.successfulReviews} = 0 and ${table.nextReviewAt} is null) or (${table.stage} = 'review' and ${table.successfulReviews} between 1 and 5 and ${table.nextReviewAt} is not null)`),
]);

/** Account-level lock and deletion generation. SQL owns the auth.users FK. */
export const userVocabularyRecallSync = pgTable("user_vocabulary_recall_sync", {
  userId: uuid("user_id").primaryKey(),
  epoch: uuid("epoch").defaultRandom().notNull(),
});

/** Hash-only idempotency receipts: no typed answers or answer keys. */
export const userVocabularyRecallReceipts = pgTable("user_vocabulary_recall_receipts", {
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  attemptId: uuid("attempt_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.userId, table.attemptId] })]);
