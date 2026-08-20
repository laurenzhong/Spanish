import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { createdAt, updatedAt, type JsonObject } from "./common";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  nativeLanguage: text("native_language").default("zh-CN").notNull(),
  interfaceLanguage: text("interface_language").default("zh-CN").notNull(),
  timezone: text("timezone").default("Asia/Shanghai").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
