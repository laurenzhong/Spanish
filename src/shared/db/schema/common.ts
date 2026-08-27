import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgEnum,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export type JsonObject = Record<string, unknown>;
export type LocalizedText = Record<string, string>;

export const createdAt = () =>
  timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  })
    .defaultNow()
    .notNull();

export const updatedAt = () =>
  timestamp("updated_at", {
    withTimezone: true,
    mode: "date",
  })
    .defaultNow()
    .notNull();

export const localizedText = (name: string) =>
  jsonb(name).$type<LocalizedText>().default(sql`'{}'::jsonb`).notNull();

export const jsonObject = (name: string) =>
  jsonb(name).$type<JsonObject>().default(sql`'{}'::jsonb`).notNull();

export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "review",
  "approved",
  "published",
  "archived",
]);

export const reviewStatusEnum = pgEnum("review_status", [
  "pending",
  "approved",
  "changes_requested",
]);

export const modalityEnum = pgEnum("learning_modality", [
  "speech",
  "typing",
  "listening",
  "reading",
]);

export const sessionStatusEnum = pgEnum("practice_session_status", [
  "active",
  "completed",
  "abandoned",
]);

export const sessionActivityEventTypeEnum = pgEnum(
  "practice_session_activity_event_type",
  ["active", "inactive", "ended"],
);

export const readingProgressStatusEnum = pgEnum("reading_progress_status", [
  "in_progress",
  "completed",
]);

export const readingItemTypeEnum = pgEnum("reading_item_type", [
  "phrase",
  "highlight",
]);

export const savedArticleSourceStatusEnum = pgEnum(
  "saved_article_source_status",
  ["saved", "blocked"],
);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "character",
  "system",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "streaming",
  "completed",
  "failed",
  "cancelled",
  "withdrawn",
]);

export const providerStatusEnum = pgEnum("provider_call_status", [
  "started",
  "succeeded",
  "failed",
  "cancelled",
]);

export const memorySensitivityEnum = pgEnum("memory_sensitivity", [
  "normal",
  "sensitive",
  "private",
]);

export const memoryShareScopeEnum = pgEnum("memory_share_scope", [
  "private",
  "character",
  "explicit",
]);

export const sourceLicenseEnum = pgEnum("content_source_license", [
  "original",
  "public_domain",
  "creative_commons",
  "licensed",
  "short_quote",
]);

export const activeFlag = () => boolean("is_active").default(true).notNull();
export const stableKey = () => text("stable_key").notNull();
