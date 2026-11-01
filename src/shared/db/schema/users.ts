import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { createdAt, updatedAt, type JsonObject } from "./common";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  publicUid: text("public_uid").notNull(),
  displayName: text("display_name"),
  avatarKind: text("avatar_kind").default("initials").notNull(),
  avatarPresetId: text("avatar_preset_id"),
  avatarPath: text("avatar_path"),
  nativeLanguage: text("native_language").default("zh-CN").notNull(),
  interfaceLanguage: text("interface_language").default("zh-CN").notNull(),
  timezone: text("timezone").default("Asia/Shanghai").notNull(),
  // Account access model (ACCT-ADMIN-001, ADR-0021). Role and status are only
  // writable by server application code; clients never receive write grants on
  // these columns. `member` + `active` keeps every pre-existing profile valid.
  role: text("role").default("member").notNull(),
  accountStatus: text("account_status").default("active").notNull(),
  deletionRequestedAt: timestamp("deletion_requested_at", {
    withTimezone: true,
    mode: "date",
  }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("profiles_public_uid_uidx").on(table.publicUid),
  index("profiles_role_status_idx").on(table.role, table.accountStatus),
  index("profiles_created_idx").on(table.createdAt),
  check(
    "profiles_avatar_kind_check",
    sql`${table.avatarKind} in ('upload', 'preset', 'initials')`,
  ),
  check("profiles_role_check", sql`${table.role} in ('owner', 'member')`),
  check(
    "profiles_account_status_check",
    sql`${table.accountStatus} in ('active', 'suspended')`,
  ),
]);

export const reservedPublicUids = pgTable(
  "reserved_public_uids",
  {
    publicUid: text("public_uid").primaryKey(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).defaultNow().notNull(),
    reason: text("reason").notNull(),
  },
  (table) => [uniqueIndex("reserved_public_uids_uidx").on(table.publicUid)],
);

export const userPreferences = pgTable(
  "user_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    preferredSpanishRegion: text("preferred_spanish_region")
      .default("es-ES")
      .notNull(),
    correctionMode: text("correction_mode").default("balanced").notNull(),
    voiceInputPreferred: text("voice_input_preferred")
      .default("preferred")
      .notNull(),
    personalityPreferences: jsonb("personality_preferences")
      .$type<JsonObject>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    learningInsightsEnabled: boolean("learning_insights_enabled")
      .default(true)
      .notNull(),
    recordAssistantLearningIntent: boolean("record_assistant_learning_intent")
      .default(true)
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "user_preferences_correction_mode_check",
      sql`${table.correctionMode} in ('balanced', 'strict')`,
    ),
    check(
      "user_preferences_voice_preference_check",
      sql`${table.voiceInputPreferred} in ('preferred', 'optional', 'silent')`,
    ),
  ],
);
