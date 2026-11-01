import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
} from "drizzle-orm/pg-core";

import { createdAt, updatedAt, type JsonObject } from "./common";
import { profiles } from "./users";

/**
 * Structured, user-owned observations used by the learning-insights pipeline.
 * These are behavioral observations only; they are deliberately separate from
 * evidence events and user skill snapshots.
 */
export const learningObservationEvents = pgTable(
  "learning_observation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    sourceModule: text("source_module").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    subjectVersion: integer("subject_version"),
    signalStrength: text("signal_strength").notNull(),
    metadata: jsonb("metadata")
      .$type<JsonObject>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    retentionUntil: timestamp("retention_until", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("learning_observation_events_user_dedupe_uidx").on(
      table.userId,
      table.dedupeKey,
    ),
    index("learning_observation_events_user_occurred_idx").on(
      table.userId,
      table.occurredAt,
    ),
    index("learning_observation_events_user_type_occurred_idx").on(
      table.userId,
      table.eventType,
      table.occurredAt,
    ),
    index("learning_observation_events_retention_idx").on(table.retentionUntil),
    check(
      "learning_observation_events_event_type_check",
      sql`${table.eventType} in ('media_exposure', 'reading_exposure', 'lookup', 'selection_explanation', 'assistant_intent', 'lexical_assessment', 'replay')`,
    ),
    check(
      "learning_observation_events_source_module_check",
      sql`${table.sourceModule} in ('media', 'reading', 'lexicon-corpus', 'conversation', 'training')`,
    ),
    check(
      "learning_observation_events_subject_type_check",
      sql`${table.subjectType} in ('lexeme', 'phrase', 'content_segment', 'skill', 'none')`,
    ),
    check(
      "learning_observation_events_signal_strength_check",
      sql`${table.signalStrength} in ('exposure', 'weak', 'moderate', 'strong')`,
    ),
    check(
      "learning_observation_events_subject_link_check",
      sql`${table.subjectType} = 'none' and ${table.subjectId} is null or ${table.subjectType} <> 'none' and ${table.subjectId} is not null`,
    ),
    check(
      "learning_observation_events_subject_version_check",
      sql`${table.subjectVersion} is null or ${table.subjectVersion} > 0`,
    ),
  ],
);

export const learningInsightReports = pgTable(
  "learning_insight_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    localDate: date("local_date", { mode: "string" }).notNull(),
    timezone: text("timezone").notNull(),
    reportVersion: integer("report_version").notNull(),
    status: text("status").notNull(),
    coverage: jsonb("coverage").$type<JsonObject>().notNull(),
    summary: text("summary").notNull(),
    candidates: jsonb("candidates").$type<unknown[]>().notNull(),
    sourceEventIds: jsonb("source_event_ids").$type<string[]>().notNull(),
    generationId: text("generation_id").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("learning_insight_reports_user_date_version_uidx").on(table.userId, table.localDate, table.reportVersion),
    index("learning_insight_reports_user_date_idx").on(table.userId, table.localDate),
    check("learning_insight_reports_status_check", sql`${table.status} in ('generated', 'insufficient_data', 'failed')`),
  ],
);

export const learningInsightFeedback = pgTable(
  "learning_insight_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull().references(() => learningInsightReports.id, { onDelete: "cascade" }),
    candidateKey: text("candidate_key").notNull(),
    feedback: text("feedback").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("learning_insight_feedback_user_report_candidate_dedupe_uidx").on(table.userId, table.reportId, table.candidateKey, table.dedupeKey),
    index("learning_insight_feedback_user_report_idx").on(table.userId, table.reportId),
    check("learning_insight_feedback_value_check", sql`${table.feedback} in ('mastered', 'not_relevant', 'review_again')`),
  ],
);
