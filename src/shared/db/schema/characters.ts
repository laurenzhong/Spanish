import { sql } from "drizzle-orm";
import {
  boolean,
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

import {
  contentStatusEnum,
  createdAt,
  localizedText,
  memorySensitivityEnum,
  memoryShareScopeEnum,
  messageRoleEnum,
  messageStatusEnum,
  stableKey,
  updatedAt,
  type JsonObject,
} from "./common";
import { profiles } from "./users";

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stableKey: stableKey(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    homeLocation: text("home_location").notNull(),
    profile: jsonb("profile").$type<JsonObject>().notNull(),
    characterVersion: integer("character_version").default(1).notNull(),
    status: contentStatusEnum("status").default("draft").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("characters_stable_version_uidx").on(
      table.stableKey,
      table.characterVersion,
    ),
    index("characters_status_idx").on(table.status),
    check(
      "characters_version_positive_check",
      sql`${table.characterVersion} > 0`,
    ),
  ],
);

export const characterCanonFacts = pgTable(
  "character_canon_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    factKey: text("fact_key").notNull(),
    value: jsonb("value").$type<JsonObject>().notNull(),
    sensitivity: memorySensitivityEnum("sensitivity")
      .default("normal")
      .notNull(),
    canonVersion: integer("canon_version").default(1).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("character_canon_facts_key_version_uidx").on(
      table.characterId,
      table.factKey,
      table.canonVersion,
    ),
    index("character_canon_facts_character_idx").on(table.characterId),
    check(
      "character_canon_facts_version_positive_check",
      sql`${table.canonVersion} > 0`,
    ),
  ],
);

export const characterRelationships = pgTable(
  "character_relationships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    status: text("status").default("active").notNull(),
    relationshipStage: text("relationship_stage")
      .default("new_contact")
      .notNull(),
    revealedCanonFactKeys: jsonb("revealed_canon_fact_keys")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    relationshipSummary: localizedText("relationship_summary"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("character_relationships_user_character_uidx").on(
      table.userId,
      table.characterId,
    ),
    index("character_relationships_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    status: text("status").default("active").notNull(),
    lastMessageAt: timestamp("last_message_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("conversations_user_last_message_idx").on(
      table.userId,
      table.lastMessageAt,
    ),
    index("conversations_user_character_idx").on(
      table.userId,
      table.characterId,
    ),
    uniqueIndex("conversations_user_character_uidx").on(
      table.userId,
      table.characterId,
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    characterId: uuid("character_id").references(() => characters.id, {
      onDelete: "restrict",
    }),
    clientMessageId: text("client_message_id").notNull(),
    generationId: text("generation_id"),
    role: messageRoleEnum("role").notNull(),
    status: messageStatusEnum("status").default("completed").notNull(),
    content: text("content").notNull(),
    replyToMessageId: uuid("reply_to_message_id"),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("messages_conversation_client_id_uidx").on(
      table.conversationId,
      table.clientMessageId,
    ),
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    index("messages_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const relationshipMemories = pgTable(
  "relationship_memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    sourceConversationId: uuid("source_conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    sourceMessageId: uuid("source_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    category: text("category").notNull(),
    content: text("content").notNull(),
    confidence: real("confidence").notNull(),
    sensitivity: memorySensitivityEnum("sensitivity")
      .default("normal")
      .notNull(),
    shareScope: memoryShareScopeEnum("share_scope").default("private").notNull(),
    status: text("status").default("candidate").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("relationship_memories_user_character_idx").on(
      table.userId,
      table.characterId,
    ),
    index("relationship_memories_user_status_idx").on(table.userId, table.status),
    check(
      "relationship_memories_confidence_range_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
    check(
      "relationship_memories_status_check",
      sql`${table.status} in ('candidate', 'confirmed', 'rejected', 'conflict')`,
    ),
  ],
);

export const memorySharingPermissions = pgTable(
  "memory_sharing_permissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => relationshipMemories.id, { onDelete: "cascade" }),
    targetCharacterId: uuid("target_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    isAllowed: boolean("is_allowed").default(true).notNull(),
    grantedAt: timestamp("granted_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("memory_sharing_permissions_target_uidx").on(
      table.memoryId,
      table.targetCharacterId,
    ),
    index("memory_sharing_permissions_user_idx").on(table.userId),
  ],
);
