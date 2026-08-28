import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("profiles_public_uid_uidx").on(table.publicUid),
  check(
    "profiles_avatar_kind_check",
    sql`${table.avatarKind} in ('upload', 'preset', 'initials')`,
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
