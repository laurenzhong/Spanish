import { sql } from "drizzle-orm";
import {
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

import { scenarios } from "./content";
import { createdAt, modalityEnum, updatedAt, type JsonObject } from "./common";
import { providerCalls } from "./infrastructure";
import { practiceAttempts } from "./training";
import { profiles } from "./users";

export const evidenceEvents = pgTable(
  "evidence_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    practiceAttemptId: uuid("practice_attempt_id").references(
      () => practiceAttempts.id,
      { onDelete: "restrict" },
    ),
    providerCallId: uuid("provider_call_id").references(() => providerCalls.id, {
      onDelete: "set null",
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    sourceType: text("source_type").notNull(),
    sourceReference: jsonb("source_reference").$type<JsonObject>(),
    skillKey: text("skill_key").notNull(),
    scenarioId: uuid("scenario_id").references(() => scenarios.id, {
      onDelete: "restrict",
    }),
    modality: modalityEnum("modality").notNull(),
    outcomeScore: real("outcome_score").notNull(),
    evidenceWeight: real("evidence_weight").notNull(),
    confidence: real("confidence").notNull(),
    contentVersion: integer("content_version").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("evidence_events_user_idempotency_uidx").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("evidence_events_user_occurred_idx").on(
      table.userId,
      table.occurredAt,
    ),
    index("evidence_events_user_skill_occurred_idx").on(
      table.userId,
      table.skillKey,
      table.occurredAt,
    ),
    index("evidence_events_attempt_idx").on(table.practiceAttemptId),
    check(
      "evidence_events_outcome_score_range_check",
      sql`${table.outcomeScore} >= 0 and ${table.outcomeScore} <= 1`,
    ),
    check(
      "evidence_events_weight_range_check",
      sql`${table.evidenceWeight} > 0 and ${table.evidenceWeight} <= 1`,
    ),
    check(
      "evidence_events_confidence_range_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
  ],
);

export const userSkillStates = pgTable(
  "user_skill_states",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    skillKey: text("skill_key").notNull(),
    mastery: real("mastery").default(0).notNull(),
    confidence: real("confidence").default(0).notNull(),
    evidenceCount: integer("evidence_count").default(0).notNull(),
    lastEvidenceAt: timestamp("last_evidence_at", {
      withTimezone: true,
      mode: "date",
    }),
    snapshotVersion: integer("snapshot_version").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.skillKey] }),
    index("user_skill_states_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
    check(
      "user_skill_states_mastery_range_check",
      sql`${table.mastery} >= 0 and ${table.mastery} <= 1`,
    ),
    check(
      "user_skill_states_confidence_range_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
  ],
);

export const userSceneStates = pgTable(
  "user_scene_states",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "cascade" }),
    status: text("status").default("unverified").notNull(),
    mastery: real("mastery").default(0).notNull(),
    confidence: real("confidence").default(0).notNull(),
    oralCoverage: real("oral_coverage").default(0).notNull(),
    evidenceCount: integer("evidence_count").default(0).notNull(),
    lastVerifiedAt: timestamp("last_verified_at", {
      withTimezone: true,
      mode: "date",
    }),
    snapshotVersion: integer("snapshot_version").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.scenarioId] }),
    index("user_scene_states_user_status_idx").on(table.userId, table.status),
    check(
      "user_scene_states_status_check",
      sql`${table.status} in ('unverified', 'learning', 'provisional', 'mastered', 'needs_review')`,
    ),
    check(
      "user_scene_states_mastery_range_check",
      sql`${table.mastery} >= 0 and ${table.mastery} <= 1`,
    ),
    check(
      "user_scene_states_confidence_range_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
    check(
      "user_scene_states_oral_coverage_range_check",
      sql`${table.oralCoverage} >= 0 and ${table.oralCoverage} <= 1`,
    ),
  ],
);
