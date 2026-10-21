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

/**
 * Stable identity for one character across revisions.
 *
 * A `characters` row is one *revision* (`stable_key` + `character_version`),
 * while user state currently points at that revision's row id. This table gives
 * user state a revision-independent target, so publishing a new revision
 * becomes a single pointer update on `current_character_id` instead of moving
 * every user-state row. Slice 1 only adds the table plus nullable
 * `identity_id` columns; no read path uses them yet.
 */
export const characterIdentities = pgTable(
  "character_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stableKey: stableKey(),
    currentCharacterId: uuid("current_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("character_identities_stable_key_uidx").on(table.stableKey),
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
    /** Nullable during the migration window; later slices read state by identity. */
    identityId: uuid("identity_id").references(() => characterIdentities.id, {
      onDelete: "restrict",
    }),
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
    index("character_relationships_identity_idx").on(table.identityId),
  ],
);

export const characterIntroductionOffers = pgTable(
  "character_introduction_offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    offerKey: text("offer_key").notNull(),
    sourceCharacterId: uuid("source_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    targetCharacterId: uuid("target_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    /** Nullable during the migration window; both stay for rollback until slice 4. */
    sourceIdentityId: uuid("source_identity_id").references(
      () => characterIdentities.id,
      { onDelete: "restrict" },
    ),
    targetIdentityId: uuid("target_identity_id").references(
      () => characterIdentities.id,
      { onDelete: "restrict" },
    ),
    reasonCode: text("reason_code").notNull(),
    reasonText: text("reason_text").notNull(),
    context: jsonb("context").$type<JsonObject>().default(sql`'{}'::jsonb`).notNull(),
    status: text("status").default("pending").notNull(),
    acceptedMemoryIds: jsonb("accepted_memory_ids")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("character_introduction_offers_user_key_uidx").on(
      table.userId,
      table.offerKey,
    ),
    index("character_introduction_offers_user_status_idx").on(
      table.userId,
      table.status,
      table.updatedAt,
    ),
    check(
      "character_introduction_offers_status_check",
      sql`${table.status} in ('pending', 'accepted', 'declined', 'expired')`,
    ),
    index("character_introduction_offers_source_identity_idx").on(
      table.sourceIdentityId,
    ),
    index("character_introduction_offers_target_identity_idx").on(
      table.targetIdentityId,
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
    /** Nullable during the migration window; the chat itself moves to the identity later. */
    identityId: uuid("identity_id").references(() => characterIdentities.id, {
      onDelete: "restrict",
    }),
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
    index("conversations_identity_idx").on(table.identityId),
  ],
);

export const conversationPreferences = pgTable(
  "conversation_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    /** Nullable during the migration window; later slices read state by identity. */
    identityId: uuid("identity_id").references(() => characterIdentities.id, {
      onDelete: "restrict",
    }),
    isPinned: boolean("is_pinned").default(false).notNull(),
    isMuted: boolean("is_muted").default(false).notNull(),
    sortRank: integer("sort_rank"),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("conversation_preferences_user_character_uidx").on(table.userId, table.characterId),
    index("conversation_preferences_user_idx").on(table.userId, table.updatedAt),
    index("conversation_preferences_identity_idx").on(table.identityId),
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
    /** Audit source stays on `character_id`; `identity_id` is for ownership queries. */
    identityId: uuid("identity_id").references(() => characterIdentities.id, {
      onDelete: "restrict",
    }),
    clientMessageId: text("client_message_id").notNull(),
    generationId: text("generation_id"),
    role: messageRoleEnum("role").notNull(),
    status: messageStatusEnum("status").default("completed").notNull(),
    sourceType: text("source_type").default("conversation").notNull(),
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
    index("messages_identity_idx").on(table.identityId),
  ],
);

/** Server-owned lifecycle for unsolicited Lucía messages. */
export const proactiveMessageCandidates = pgTable(
  "proactive_message_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    /** Nullable during the migration window; dedupe state follows the identity later. */
    identityId: uuid("identity_id").references(() => characterIdentities.id, {
      onDelete: "restrict",
    }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    generationId: text("generation_id").notNull(),
    notBefore: timestamp("not_before", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    status: text("status").default("pending").notNull(),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    notificationStatus: text("notification_status").default("not_requested").notNull(),
    lastErrorCode: text("last_error_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("proactive_candidates_user_dedupe_uidx").on(table.userId, table.dedupeKey),
    index("proactive_candidates_user_status_idx").on(table.userId, table.status, table.updatedAt),
    index("proactive_candidates_user_character_idx").on(table.userId, table.characterId, table.createdAt),
    index("proactive_candidates_identity_idx").on(table.identityId),
    check(
      "proactive_candidates_status_check",
      sql`${table.status} in ('pending', 'generating', 'generated', 'suppressed', 'failed', 'expired')`,
    ),
    check(
      "proactive_candidates_notification_status_check",
      sql`${table.notificationStatus} in ('not_requested', 'pending', 'delivered', 'failed', 'suppressed')`,
    ),
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
    /** Nullable during the migration window; the memory's owner becomes the identity. */
    identityId: uuid("identity_id").references(() => characterIdentities.id, {
      onDelete: "restrict",
    }),
    sourceConversationId: uuid("source_conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    sourceMessageId: uuid("source_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    factKey: text("fact_key").notNull(),
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
    index("relationship_memories_user_character_fact_idx").on(
      table.userId,
      table.characterId,
      table.factKey,
    ),
    index("relationship_memories_identity_idx").on(table.identityId),
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
    /** Nullable during the migration window; sharing grants move to the identity later. */
    targetIdentityId: uuid("target_identity_id").references(
      () => characterIdentities.id,
      { onDelete: "restrict" },
    ),
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
    index("memory_sharing_permissions_target_identity_idx").on(
      table.targetIdentityId,
    ),
  ],
);
