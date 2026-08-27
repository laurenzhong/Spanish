import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  createdAt,
  readingItemTypeEnum,
  readingProgressStatusEnum,
  savedArticleSourceStatusEnum,
  sourceLicenseEnum,
  updatedAt,
} from "./common";
import { articleVersions } from "./content";
import { profiles } from "./users";

export const userGeneratedArticles = pgTable(
  "user_generated_articles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    articleVersionId: uuid("article_version_id")
      .notNull()
      .references(() => articleVersions.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    cefr: text("cefr").notNull(),
    length: text("length").notNull(),
    format: text("format").notNull(),
    keywords: text("keywords").array().default(sql`ARRAY[]::text[]`).notNull(),
    provider: text("provider").notNull(),
    modelVersion: text("model_version").notNull(),
    providerRequestId: text("provider_request_id"),
    requestId: text("request_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    contentHash: text("content_hash").notNull(),
    status: text("status").default("ready").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("user_generated_articles_article_version_uidx").on(table.articleVersionId),
    uniqueIndex("user_generated_articles_user_idempotency_uidx").on(table.userId, table.idempotencyKey),
    index("user_generated_articles_user_created_idx").on(table.userId, table.createdAt),
    check("user_generated_articles_prompt_length_check", sql`char_length(${table.prompt}) between 1 and 500`),
    check("user_generated_articles_cefr_check", sql`${table.cefr} in ('A1', 'A2', 'B1', 'B2')`),
    check("user_generated_articles_length_check", sql`${table.length} in ('short', 'medium', 'long')`),
    check("user_generated_articles_format_check", sql`${table.format} in ('story', 'dialogue', 'guide')`),
    check("user_generated_articles_status_check", sql`${table.status} = 'ready'`),
  ],
);

export const userReadingProgress = pgTable(
  "user_reading_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    articleVersionId: uuid("article_version_id")
      .notNull()
      .references(() => articleVersions.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    position: integer("position").default(0).notNull(),
    status: readingProgressStatusEnum("status").default("in_progress").notNull(),
    note: text("note").default("").notNull(),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("user_reading_progress_user_article_uidx").on(
      table.userId,
      table.articleVersionId,
    ),
    index("user_reading_progress_user_last_opened_idx").on(
      table.userId,
      table.lastOpenedAt,
    ),
    check("user_reading_progress_position_nonnegative_check", sql`${table.position} >= 0`),
    check("user_reading_progress_note_length_check", sql`char_length(${table.note}) <= 2000`),
  ],
);

export const userArticleSaves = pgTable(
  "user_article_saves",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    articleVersionId: uuid("article_version_id")
      .notNull()
      .references(() => articleVersions.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("user_article_saves_user_article_uidx").on(
      table.userId,
      table.articleVersionId,
    ),
    index("user_article_saves_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const userArticleHighlights = pgTable(
  "user_article_highlights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    articleVersionId: uuid("article_version_id")
      .notNull()
      .references(() => articleVersions.id, { onDelete: "cascade" }),
    itemType: readingItemTypeEnum("item_type").notNull(),
    segmentPosition: integer("segment_position").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("user_article_highlights_identity_uidx").on(
      table.userId,
      table.articleVersionId,
      table.itemType,
      table.segmentPosition,
      table.text,
    ),
    index("user_article_highlights_user_article_idx").on(
      table.userId,
      table.articleVersionId,
    ),
    check("user_article_highlights_position_nonnegative_check", sql`${table.segmentPosition} >= 0`),
    check("user_article_highlights_text_length_check", sql`char_length(${table.text}) between 1 and 500`),
  ],
);

export const userSavedArticleSources = pgTable(
  "user_saved_article_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    title: text("title"),
    author: text("author"),
    sourceName: text("source_name"),
    license: sourceLicenseEnum("license"),
    copyrightStatus: text("copyright_status").default("unverified").notNull(),
    status: savedArticleSourceStatusEnum("status").default("saved").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("user_saved_article_sources_user_url_uidx").on(
      table.userId,
      table.normalizedUrl,
    ),
    index("user_saved_article_sources_user_created_idx").on(table.userId, table.createdAt),
    check(
      "user_saved_article_sources_copyright_status_check",
      sql`${table.copyrightStatus} in ('unverified', 'cleared', 'restricted')`,
    ),
    check("user_saved_article_sources_url_length_check", sql`char_length(${table.sourceUrl}) <= 2048`),
  ],
);
