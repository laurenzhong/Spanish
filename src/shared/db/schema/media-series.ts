import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { createdAt, updatedAt } from "./common";
import { mediaItems, mediaKindEnum } from "./media";

export const mediaSeries = pgTable("media_series", {
  id: uuid("id").defaultRandom().primaryKey(),
  seriesKey: text("series_key").notNull(),
  title: text("title").notNull(),
  summary: text("summary").default("").notNull(),
  kind: mediaKindEnum("kind").notNull(),
  orderMode: text("order_mode").$type<"ordered" | "episodic">().notNull(),
  status: text("status").$type<"active" | "archived">().default("active").notNull(),
  revision: integer("revision").default(1).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("media_series_key_uidx").on(table.seriesKey),
  check("media_series_key_check", sql`length(trim(${table.seriesKey})) > 0`),
  check("media_series_title_check", sql`length(trim(${table.title})) > 0`),
  check("media_series_order_mode_check", sql`${table.orderMode} in ('ordered', 'episodic')`),
  check("media_series_status_check", sql`${table.status} in ('active', 'archived')`),
  check("media_series_revision_check", sql`${table.revision} > 0`),
]);

export const mediaSeriesMemberships = pgTable("media_series_memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  mediaItemId: uuid("media_item_id").notNull().references(() => mediaItems.id, { onDelete: "restrict" }),
  seriesId: uuid("series_id").notNull().references(() => mediaSeries.id, { onDelete: "restrict" }),
  position: integer("position"),
  seasonNumber: integer("season_number"),
  episodeNumber: integer("episode_number"),
  episodeLabel: text("episode_label"),
  evidence: jsonb("evidence").$type<string[]>().notNull(),
  // Audit identities survive account deletion; no FK to profiles.
  confirmedBy: uuid("confirmed_by").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("media_series_memberships_item_uidx").on(table.mediaItemId),
  uniqueIndex("media_series_memberships_position_uidx").on(table.seriesId, table.position),
  index("media_series_memberships_series_idx").on(table.seriesId),
  check("media_series_memberships_position_check", sql`${table.position} is null or ${table.position} > 0`),
  check("media_series_memberships_numbers_check", sql`(${table.seasonNumber} is null or ${table.seasonNumber} >= 0) and (${table.episodeNumber} is null or ${table.episodeNumber} >= 0)`),
  check("media_series_memberships_evidence_check", sql`jsonb_typeof(${table.evidence}) = 'array' and jsonb_array_length(${table.evidence}) > 0`),
]);

export const mediaSeriesChanges = pgTable("media_series_changes", {
  id: uuid("id").defaultRandom().primaryKey(),
  seriesId: uuid("series_id").notNull().references(() => mediaSeries.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  expectedRevision: integer("expected_revision").notNull(),
  actorUserId: uuid("actor_user_id").notNull(),
  reason: text("reason").notNull(),
  evidence: jsonb("evidence").$type<string[]>().notNull(),
  beforeState: jsonb("before_state").$type<Record<string, unknown>>(),
  afterState: jsonb("after_state").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("media_series_changes_idempotency_uidx").on(table.seriesId, table.idempotencyKey),
  index("media_series_changes_series_created_idx").on(table.seriesId, table.createdAt),
  check("media_series_changes_revision_check", sql`${table.expectedRevision} >= 0`),
  check("media_series_changes_key_check", sql`length(trim(${table.idempotencyKey})) > 0`),
  check("media_series_changes_hash_check", sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
  check("media_series_changes_reason_check", sql`length(trim(${table.reason})) > 0`),
  check("media_series_changes_evidence_check", sql`jsonb_typeof(${table.evidence}) = 'array' and jsonb_array_length(${table.evidence}) > 0`),
]);
