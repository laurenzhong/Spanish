import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { learningGoals, scenarioTasks, scenarios } from "./content";
import {
  createdAt,
  modalityEnum,
  sessionStatusEnum,
  updatedAt,
  type JsonObject,
} from "./common";
import { audioAssets } from "./infrastructure";
import { profiles } from "./users";

export const practiceSessions = pgTable(
  "practice_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => learningGoals.id, {
      onDelete: "restrict",
    }),
    scenarioId: uuid("scenario_id").references(() => scenarios.id, {
      onDelete: "restrict",
    }),
    status: sessionStatusEnum("status").default("active").notNull(),
    primaryModality: modalityEnum("primary_modality").notNull(),
    contentVersion: integer("content_version").notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("practice_sessions_user_started_idx").on(
      table.userId,
      table.startedAt,
    ),
    index("practice_sessions_user_status_idx").on(table.userId, table.status),
    check(
      "practice_sessions_content_version_positive_check",
      sql`${table.contentVersion} > 0`,
    ),
  ],
);

export const practiceAttempts = pgTable(
  "practice_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    scenarioTaskId: uuid("scenario_task_id").references(() => scenarioTasks.id, {
      onDelete: "restrict",
    }),
    clientAttemptId: text("client_attempt_id").notNull(),
    modality: modalityEnum("modality").notNull(),
    responseText: text("response_text"),
    audioAssetId: uuid("audio_asset_id").references(() => audioAssets.id, {
      onDelete: "set null",
    }),
    hintLevel: integer("hint_level").default(0).notNull(),
    transcriptConfidence: real("transcript_confidence"),
    evaluation: jsonb("evaluation").$type<JsonObject>(),
    contentVersion: integer("content_version").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("practice_attempts_user_client_attempt_uidx").on(
      table.userId,
      table.clientAttemptId,
    ),
    index("practice_attempts_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    check(
      "practice_attempts_hint_level_check",
      sql`${table.hintLevel} >= 0 and ${table.hintLevel} <= 3`,
    ),
    check(
      "practice_attempts_transcript_confidence_check",
      sql`${table.transcriptConfidence} is null or (${table.transcriptConfidence} >= 0 and ${table.transcriptConfidence} <= 1)`,
    ),
  ],
);

export const learningBreakpoints = pgTable(
  "learning_breakpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    state: jsonb("state").$type<JsonObject>().notNull(),
    generation: integer("generation").default(1).notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("learning_breakpoints_session_uidx").on(table.sessionId),
    index("learning_breakpoints_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
    check(
      "learning_breakpoints_generation_positive_check",
      sql`${table.generation} > 0`,
    ),
  ],
);
