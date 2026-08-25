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
} from "drizzle-orm/pg-core";

import {
  createdAt,
  providerStatusEnum,
  updatedAt,
  type JsonObject,
} from "./common";
import { profiles } from "./users";

export const audioAssets = pgTable(
  "audio_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
    storageBucket: text("storage_bucket").notNull(),
    storagePath: text("storage_path").notNull(),
    purpose: text("purpose").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    durationMs: integer("duration_ms"),
    retentionPolicy: text("retention_policy").default("ephemeral").notNull(),
    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("audio_assets_storage_location_uidx").on(
      table.storageBucket,
      table.storagePath,
    ),
    index("audio_assets_user_created_idx").on(table.userId, table.createdAt),
    check("audio_assets_size_nonnegative_check", sql`${table.sizeBytes} >= 0`),
    check(
      "audio_assets_duration_nonnegative_check",
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
  ],
);

export const providerCalls = pgTable(
  "provider_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    providerType: text("provider_type").notNull(),
    provider: text("provider").notNull(),
    modelVersion: text("model_version"),
    providerRequestId: text("provider_request_id"),
    status: providerStatusEnum("status").default("started").notNull(),
    latencyMs: integer("latency_ms"),
    estimatedCostMicros: integer("estimated_cost_micros"),
    confidence: integer("confidence_basis_points"),
    metadata: jsonb("metadata")
      .$type<JsonObject>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
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
    index("provider_calls_user_started_idx").on(table.userId, table.startedAt),
    index("provider_calls_provider_status_idx").on(
      table.providerType,
      table.status,
    ),
    check(
      "provider_calls_latency_nonnegative_check",
      sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`,
    ),
    check(
      "provider_calls_confidence_range_check",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 10000)`,
    ),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").default("started").notNull(),
    responseReference: jsonb("response_reference").$type<JsonObject>(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_scope_key_uidx").on(table.scope, table.key),
    index("idempotency_keys_user_created_idx").on(table.userId, table.createdAt),
    index("idempotency_keys_expires_idx").on(table.expiresAt),
    check(
      "idempotency_keys_status_check",
      sql`${table.status} in ('started', 'completed', 'failed')`,
    ),
  ],
);

export const privacyCleanupTasks = pgTable(
  "privacy_cleanup_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storageBucket: text("storage_bucket").notNull(),
    storagePath: text("storage_path").notNull(),
    status: text("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
      mode: "date",
    }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("privacy_cleanup_tasks_location_uidx").on(
      table.storageBucket,
      table.storagePath,
    ),
    index("privacy_cleanup_tasks_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    check(
      "privacy_cleanup_tasks_status_check",
      sql`${table.status} in ('pending', 'processing', 'completed', 'failed')`,
    ),
    check(
      "privacy_cleanup_tasks_attempts_nonnegative_check",
      sql`${table.attempts} >= 0`,
    ),
  ],
);
