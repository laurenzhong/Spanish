import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  activeFlag,
  contentStatusEnum,
  createdAt,
  jsonObject,
  localizedText,
  reviewStatusEnum,
  sourceLicenseEnum,
  stableKey,
  updatedAt,
  type JsonObject,
} from "./common";
import { audioAssets } from "./infrastructure";

export const communicationDomains = pgTable(
  "communication_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stableKey: stableKey(),
    title: localizedText("title"),
    description: localizedText("description"),
    position: integer("position").default(0).notNull(),
    status: contentStatusEnum("status").default("draft").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("communication_domains_stable_key_uidx").on(table.stableKey),
    index("communication_domains_status_position_idx").on(
      table.status,
      table.position,
    ),
  ],
);

export const learningGoals = pgTable(
  "learning_goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => communicationDomains.id, { onDelete: "restrict" }),
    stableKey: stableKey(),
    title: localizedText("title"),
    description: localizedText("description"),
    cefrMin: text("cefr_min").default("A1").notNull(),
    cefrMax: text("cefr_max").default("B1").notNull(),
    position: integer("position").default(0).notNull(),
    status: contentStatusEnum("status").default("draft").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("learning_goals_stable_key_uidx").on(table.stableKey),
    index("learning_goals_domain_position_idx").on(
      table.domainId,
      table.position,
    ),
  ],
);

export const expressions = pgTable(
  "expressions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => learningGoals.id, { onDelete: "restrict" }),
    stableKey: stableKey(),
    sourceText: text("source_text").notNull(),
    translations: localizedText("translations"),
    communicativeIntent: localizedText("communicative_intent"),
    chunks: jsonb("chunks")
      .$type<JsonObject[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    grammarNotes: jsonObject("grammar_notes"),
    pronunciationNotes: jsonObject("pronunciation_notes"),
    usageNotes: jsonObject("usage_notes"),
    cefrLevel: text("cefr_level").notNull(),
    register: text("register").default("neutral").notNull(),
    region: text("region").default("es-ES").notNull(),
    frequency: text("frequency").default("core").notNull(),
    contentVersion: integer("content_version").default(1).notNull(),
    status: contentStatusEnum("status").default("draft").notNull(),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("expressions_stable_version_uidx").on(
      table.stableKey,
      table.contentVersion,
    ),
    index("expressions_goal_status_idx").on(table.goalId, table.status),
    check("expressions_version_positive_check", sql`${table.contentVersion} > 0`),
    check(
      "expressions_frequency_check",
      sql`${table.frequency} in ('core', 'common', 'extension')`,
    ),
  ],
);

export const expressionVariants = pgTable(
  "expression_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expressionId: uuid("expression_id")
      .notNull()
      .references(() => expressions.id, { onDelete: "cascade" }),
    variantText: text("variant_text").notNull(),
    usageNotes: localizedText("usage_notes"),
    region: text("region"),
    register: text("register"),
    position: integer("position").default(0).notNull(),
    status: contentStatusEnum("status").default("draft").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("expression_variants_expression_position_idx").on(
      table.expressionId,
      table.position,
    ),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stableKey: stableKey(),
    category: text("category").notNull(),
    label: localizedText("label"),
    description: localizedText("description"),
    isActive: activeFlag(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("tags_stable_key_uidx").on(table.stableKey)],
);

export const expressionTags = pgTable(
  "expression_tags",
  {
    expressionId: uuid("expression_id")
      .notNull()
      .references(() => expressions.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "restrict" }),
    weight: real("weight").notNull(),
    scoring: boolean("scoring").default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.expressionId, table.tagId] }),
    index("expression_tags_tag_idx").on(table.tagId),
    check(
      "expression_tags_weight_range_check",
      sql`${table.weight} > 0 and ${table.weight} <= 1`,
    ),
  ],
);

export const scenarios = pgTable(
  "scenarios",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stableKey: stableKey(),
    title: localizedText("title"),
    description: localizedText("description"),
    setting: text("setting").notNull(),
    relationshipType: text("relationship_type").notNull(),
    cefrLevel: text("cefr_level").notNull(),
    contentVersion: integer("content_version").default(1).notNull(),
    status: contentStatusEnum("status").default("draft").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("scenarios_stable_version_uidx").on(
      table.stableKey,
      table.contentVersion,
    ),
    index("scenarios_status_cefr_idx").on(table.status, table.cefrLevel),
  ],
);

export const scenarioTasks = pgTable(
  "scenario_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => learningGoals.id, { onDelete: "restrict" }),
    prompt: localizedText("prompt"),
    successCriteria: jsonObject("success_criteria"),
    targetExpressionKeys: jsonb("target_expression_keys")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("scenario_tasks_scenario_position_uidx").on(
      table.scenarioId,
      table.position,
    ),
  ],
);

export const contentPacks = pgTable(
  "content_packs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stableKey: stableKey(),
    title: localizedText("title"),
    summary: localizedText("summary"),
    cefrLevel: text("cefr_level").notNull(),
    contentVersion: integer("content_version").default(1).notNull(),
    status: contentStatusEnum("status").default("draft").notNull(),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("content_packs_stable_version_uidx").on(
      table.stableKey,
      table.contentVersion,
    ),
    index("content_packs_status_cefr_idx").on(table.status, table.cefrLevel),
  ],
);

export const contentPackSegments = pgTable(
  "content_pack_segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentPackId: uuid("content_pack_id")
      .notNull()
      .references(() => contentPacks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    sourceText: text("source_text").notNull(),
    translations: localizedText("translations"),
    chunks: jsonb("chunks")
      .$type<JsonObject[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    audioAssetId: uuid("audio_asset_id").references(() => audioAssets.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("content_pack_segments_pack_position_uidx").on(
      table.contentPackId,
      table.position,
    ),
  ],
);

export const contentPackActivities = pgTable(
  "content_pack_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentPackId: uuid("content_pack_id")
      .notNull()
      .references(() => contentPacks.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id").references(() => contentPackSegments.id, {
      onDelete: "cascade",
    }),
    activityType: text("activity_type").notNull(),
    modality: text("modality").notNull(),
    instructions: localizedText("instructions"),
    configuration: jsonObject("configuration"),
    position: integer("position").default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("content_pack_activities_pack_position_idx").on(
      table.contentPackId,
      table.position,
    ),
  ],
);

export const contentSources = pgTable(
  "content_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentPackId: uuid("content_pack_id")
      .notNull()
      .references(() => contentPacks.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    sourceUrl: text("source_url"),
    license: sourceLicenseEnum("license").notNull(),
    attribution: text("attribution"),
    licenseEvidence: text("license_evidence"),
    copyrightStatus: text("copyright_status")
      .default("unverified")
      .notNull(),
    reviewNotes: text("review_notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("content_sources_pack_idx").on(table.contentPackId),
    check(
      "content_sources_copyright_status_check",
      sql`${table.copyrightStatus} in ('unverified', 'cleared', 'restricted')`,
    ),
  ],
);

export const contentBundleImports = pgTable(
  "content_bundle_imports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stableKey: stableKey(),
    bundleVersion: integer("bundle_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    contentHash: text("content_hash").notNull(),
    entityCounts: jsonObject("entity_counts"),
    importedAt: timestamp("imported_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("content_bundle_imports_stable_version_uidx").on(
      table.stableKey,
      table.bundleVersion,
    ),
    index("content_bundle_imports_imported_at_idx").on(table.importedAt),
    check(
      "content_bundle_imports_version_positive_check",
      sql`${table.bundleVersion} > 0`,
    ),
  ],
);

export const contentReviews = pgTable(
  "content_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    locale: text("locale").notNull(),
    status: reviewStatusEnum("status").default("pending").notNull(),
    reviewerReference: text("reviewer_reference"),
    notes: text("notes"),
    reviewedAt: timestamp("reviewed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("content_reviews_entity_idx").on(table.entityType, table.entityId),
    index("content_reviews_status_idx").on(table.status),
  ],
);
