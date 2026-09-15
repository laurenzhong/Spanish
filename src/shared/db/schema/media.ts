import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { contentStatusEnum, createdAt, reviewStatusEnum, sourceLicenseEnum, updatedAt } from "./common";
import { profiles } from "./users";

export const mediaKindEnum = pgEnum("media_kind", ["video", "podcast"]);
export const mediaAssetKindEnum = pgEnum("media_asset_kind", ["official_embed", "audio", "video"]);
export const mediaAssetAvailabilityEnum = pgEnum("media_asset_availability", ["available", "unavailable", "withdrawn"]);
export const mediaProgressStatusEnum = pgEnum("media_progress_status", ["in_progress", "completed"]);
export const mediaArtworkSourceEnum = pgEnum("media_artwork_source", ["youtube", "podcast-feed", "fallback"]);

export const mediaItems = pgTable("media_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  stableKey: text("stable_key").notNull(),
  kind: mediaKindEnum("kind").notNull(),
  currentVersion: integer("current_version"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("media_items_stable_key_uidx").on(table.stableKey),
  check("media_items_current_version_positive_check", sql`${table.currentVersion} is null or ${table.currentVersion} > 0`),
]);

export const mediaVersions = pgTable("media_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  mediaItemId: uuid("media_item_id").notNull().references(() => mediaItems.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  locale: text("locale").default("es-ES").notNull(),
  title: text("title").notNull(),
  summary: text("summary").default("").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  platformSourceId: text("platform_source_id"),
  sourceChannelId: text("source_channel_id"),
  sourceFeedUrl: text("source_feed_url"),
  enclosureUrlHash: text("enclosure_url_hash"),
  language: text("language").default("es").notNull(),
  region: text("region"),
  cefr: text("cefr"),
  topics: text("topics").array().default(sql`ARRAY[]::text[]`).notNull(),
  durationMs: integer("duration_ms").notNull(),
  publicationDate: timestamp("publication_date", { withTimezone: true, mode: "date" }),
  curatedAt: timestamp("curated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
  contentHash: text("content_hash").notNull(),
  status: contentStatusEnum("status").default("draft").notNull(),
  license: sourceLicenseEnum("license").notNull(),
  attribution: text("attribution").notNull(),
  licenseEvidence: text("license_evidence").notNull(),
  copyrightStatus: text("copyright_status").default("unverified").notNull(),
  acquisitionCandidateId: uuid("acquisition_candidate_id"),
  acquisitionCandidateRevision: integer("acquisition_candidate_revision"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "date" }),
  changeReason: text("change_reason"),
  reviewNotes: text("review_notes"),
  artworkUrl: text("artwork_url"),
  artworkAlt: text("artwork_alt"),
  artworkSource: mediaArtworkSourceEnum("artwork_source"),
  artworkWidth: integer("artwork_width"),
  artworkHeight: integer("artwork_height"),
  artworkExpiresAt: timestamp("artwork_expires_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("media_versions_item_version_uidx").on(table.mediaItemId, table.version),
  index("media_versions_status_curated_idx").on(table.status, table.curatedAt),
  uniqueIndex("media_versions_candidate_revision_uidx")
    .on(table.acquisitionCandidateId, table.acquisitionCandidateRevision)
    .where(sql`${table.acquisitionCandidateId} is not null`),
  check("media_versions_version_positive_check", sql`${table.version} > 0`),
  check("media_versions_duration_positive_check", sql`${table.durationMs} > 0`),
  check("media_versions_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  check("media_versions_cefr_check", sql`${table.cefr} is null or ${table.cefr} in ('A2', 'B1')`),
  check("media_versions_copyright_check", sql`${table.copyrightStatus} in ('unverified', 'cleared', 'restricted')`),
  check("media_versions_source_feed_url_check", sql`${table.sourceFeedUrl} is null or ${table.sourceFeedUrl} ~ '^https://'`),
  check("media_versions_enclosure_url_hash_check", sql`${table.enclosureUrlHash} is null or ${table.enclosureUrlHash} ~ '^[a-f0-9]{64}$'`),
  check("media_versions_acquisition_provenance_check", sql`(${table.acquisitionCandidateId} is null and ${table.acquisitionCandidateRevision} is null and ${table.fetchedAt} is null) or (${table.acquisitionCandidateId} is not null and ${table.acquisitionCandidateRevision} > 0 and ${table.fetchedAt} is not null)`),
  check("media_versions_artwork_url_check", sql`${table.artworkUrl} is null or ${table.artworkUrl} ~ '^https://'`),
  check("media_versions_artwork_fields_check", sql`(${table.artworkUrl} is null and ${table.artworkAlt} is null and ${table.artworkSource} is null and ${table.artworkWidth} is null and ${table.artworkHeight} is null and ${table.artworkExpiresAt} is null) or (${table.artworkUrl} is not null and ${table.artworkAlt} is not null and ${table.artworkSource} is not null and ((${table.artworkWidth} is null and ${table.artworkHeight} is null) or (${table.artworkWidth} > 0 and ${table.artworkHeight} > 0)))`),
]);

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  mediaVersionId: uuid("media_version_id").notNull().references(() => mediaVersions.id, { onDelete: "cascade" }),
  kind: mediaAssetKindEnum("kind").notNull(),
  providerKey: text("provider_key").notNull(),
  playbackUrl: text("playback_url").notNull(),
  playbackExpiresAt: timestamp("playback_expires_at", { withTimezone: true, mode: "date" }),
  mimeType: text("mime_type"),
  availability: mediaAssetAvailabilityEnum("availability").default("available").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("media_assets_version_kind_uidx").on(table.mediaVersionId, table.kind),
  index("media_assets_availability_idx").on(table.availability),
  check("media_assets_https_check", sql`${table.playbackUrl} ~ '^https://'`),
  check("media_assets_expiry_policy_check", sql`${table.kind} = 'official_embed' or ${table.providerKey} = 'language-reactor' or ${table.providerKey} like 'supabase-storage:%' or ${table.playbackExpiresAt} is not null`),
]);

export const mediaSegments = pgTable("media_segments", {
  id: uuid("id").defaultRandom().primaryKey(),
  mediaVersionId: uuid("media_version_id").notNull().references(() => mediaVersions.id, { onDelete: "cascade" }),
  segmentIndex: integer("segment_index").notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  speaker: text("speaker"),
  sourceText: text("source_text").notNull(),
  translation: text("translation"),
  confidence: real("confidence"),
  sourceKind: text("source_kind"),
  reviewStatus: reviewStatusEnum("review_status").default("pending").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("media_segments_version_index_uidx").on(table.mediaVersionId, table.segmentIndex),
  index("media_segments_version_start_idx").on(table.mediaVersionId, table.startMs),
  check("media_segments_time_check", sql`${table.segmentIndex} >= 0 and ${table.startMs} >= 0 and ${table.endMs} > ${table.startMs}`),
  check("media_segments_confidence_check", sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`),
  check("media_segments_source_kind_check", sql`${table.sourceKind} is null or ${table.sourceKind} in ('platform_manual', 'platform_auto', 'asr')`),
]);

export const userMediaProgress = pgTable("user_media_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  mediaVersionId: uuid("media_version_id").notNull().references(() => mediaVersions.id, { onDelete: "cascade" }),
  lastPositionMs: integer("last_position_ms").default(0).notNull(),
  lastSegmentIndex: integer("last_segment_index"),
  status: mediaProgressStatusEnum("status").default("in_progress").notNull(),
  revision: integer("revision").default(1).notNull(),
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("user_media_progress_user_version_uidx").on(table.userId, table.mediaVersionId),
  index("user_media_progress_user_opened_idx").on(table.userId, table.lastOpenedAt),
  check("user_media_progress_values_check", sql`${table.lastPositionMs} >= 0 and (${table.lastSegmentIndex} is null or ${table.lastSegmentIndex} >= 0) and ${table.revision} > 0`),
]);
