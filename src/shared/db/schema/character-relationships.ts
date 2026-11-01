import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { characterIdentities, messages } from "./characters";
import { profiles } from "./users";

const owner = { userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }), identityId: uuid("identity_id").notNull().references(() => characterIdentities.id, { onDelete: "cascade" }) };
export const relationshipHeads = pgTable("relationship_heads", {
  id: uuid("id").defaultRandom().primaryKey(), ...owner,
  epoch: uuid("epoch").defaultRandom().notNull(), controlRevision: bigint("control_revision", { mode: "number" }).default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("relationship_heads_user_identity_uidx").on(t.userId, t.identityId), check("relationship_heads_revision_check", sql`${t.controlRevision} >= 0`)]);

export const relationshipEvents = pgTable("relationship_events", {
  id: uuid("id").defaultRandom().primaryKey(), headId: uuid("head_id").notNull().references(() => relationshipHeads.id, { onDelete: "cascade" }), ...owner,
  sequence: bigint("sequence", { mode: "number" }).notNull(), idempotencyKey: text("idempotency_key").notNull(), eventKind: text("event_kind").notNull(), certainty: text("certainty").notNull(), ruleVersion: text("rule_version").notNull(), generationId: text("generation_id"), turnId: text("turn_id"), characterVersion: integer("character_version"), episodeKey: text("episode_key"), payload: jsonb("payload").default(sql`'{}'::jsonb`).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("relationship_events_head_idempotency_uidx").on(t.headId, t.idempotencyKey), uniqueIndex("relationship_events_head_sequence_uidx").on(t.headId, t.sequence), index("relationship_events_head_idx").on(t.headId), check("relationship_events_sequence_check", sql`${t.sequence} > 0`), check("relationship_events_certainty_check", sql`${t.certainty} in ('explicit','supported','uncertain')`), check("relationship_events_payload_no_content_check", sql`not (${t.payload} ? 'content') and not (${t.payload} ? 'rawText')`)]);

export const relationshipEventSources = pgTable("relationship_event_sources", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => relationshipEvents.id, { onDelete: "cascade" }), messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }), sourceRole: text("source_role").notNull(), position: integer("position").notNull(), sourceDeletedAt: timestamp("source_deleted_at", { withTimezone: true }), tombstoned: boolean("tombstoned").default(false).notNull(),
}, (t) => [uniqueIndex("relationship_event_sources_event_message_uidx").on(t.eventId, t.messageId), index("relationship_event_sources_message_idx").on(t.messageId), check("relationship_event_sources_role_check", sql`${t.sourceRole} in ('user','character')`), check("relationship_event_sources_position_check", sql`${t.position} >= 0`)]);

export const relationshipBoundaries = pgTable("relationship_boundaries", {
  id: uuid("id").defaultRandom().primaryKey(), headId: uuid("head_id").notNull().references(() => relationshipHeads.id, { onDelete: "cascade" }), ...owner, scope: text("scope").notNull(), target: text("target").notNull(), status: text("status").notNull().default("active"), sourceEventId: uuid("source_event_id").references(() => relationshipEvents.id, { onDelete: "set null" }), revision: bigint("revision", { mode: "number" }).notNull(), idempotencyKey: text("idempotency_key").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("relationship_boundaries_head_idempotency_uidx").on(t.headId, t.idempotencyKey), index("relationship_boundaries_active_idx").on(t.headId, t.status, t.scope), check("relationship_boundaries_scope_check", sql`${t.scope} in ('romance','nickname','topic','proactive','contact')`), check("relationship_boundaries_status_check", sql`${t.status} in ('active','released','suspended')`), check("relationship_boundaries_revision_check", sql`${t.revision} >= 0`)]);

export const relationshipPendingSources = pgTable("relationship_pending_sources", {
  id: uuid("id").defaultRandom().primaryKey(), headId: uuid("head_id").notNull().references(() => relationshipHeads.id, { onDelete: "cascade" }), ...owner, generationId: text("generation_id"), turnId: text("turn_id"), receiptKey: text("receipt_key").notNull(), status: text("status").notNull().default("pending"), attemptCount: integer("attempt_count").notNull().default(0), nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("relationship_pending_sources_head_receipt_uidx").on(t.headId, t.receiptKey), index("relationship_pending_sources_due_idx").on(t.headId, t.status, t.nextAttemptAt), check("relationship_pending_sources_status_check", sql`${t.status} in ('pending','processing','failed','completed')`), check("relationship_pending_sources_attempt_check", sql`${t.attemptCount} >= 0`)]);
