import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, updatedAt, type JsonObject } from "./common";

/**
 * Server-only invitation ledger for the invite-only account model
 * (ACCT-ADMIN-001, ADR-0021). The plaintext invitation code is never stored:
 * only its SHA-256 hash is persisted and the code is returned once at creation.
 * `email` is required to match the redeeeming account and is never exposed to
 * the browser except masked.
 */
export const accountInvitations = pgTable(
  "account_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    role: text("role").default("member").notNull(),
    status: text("status").default("pending").notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedByUserId: uuid("invited_by_user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    acceptedUserId: uuid("accepted_user_id"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    failedAt: timestamp("failed_at", { withTimezone: true, mode: "date" }),
    failureCode: text("failure_code"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("account_invitations_token_hash_uidx").on(table.tokenHash),
    uniqueIndex("account_invitations_pending_email_uidx")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.status} in ('pending', 'redeeming')`),
    index("account_invitations_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    index("account_invitations_email_idx").on(sql`lower(${table.email})`),
    check(
      "account_invitations_role_check",
      sql`${table.role} in ('owner', 'member')`,
    ),
    check(
      "account_invitations_status_check",
      sql`${table.status} in ('pending', 'redeeming', 'accepted', 'expired', 'revoked', 'failed')`,
    ),
    check(
      "account_invitations_token_hash_check",
      sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "account_invitations_email_check",
      sql`${table.email} = lower(${table.email}) and length(${table.email}) between 3 and 320 and position('@' in ${table.email}) > 1`,
    ),
    check(
      "account_invitations_accepted_fields_check",
      sql`(${table.status} = 'accepted' and ${table.acceptedUserId} is not null and ${table.acceptedAt} is not null) or (${table.status} <> 'accepted' and ${table.acceptedUserId} is null and ${table.acceptedAt} is null)`,
    ),
    check(
      "account_invitations_failure_fields_check",
      sql`(${table.status} = 'failed' and ${table.failureCode} is not null and ${table.failedAt} is not null) or (${table.status} <> 'failed' and ${table.failureCode} is null and ${table.failedAt} is null)`,
    ),
    check(
      "account_invitations_revoked_at_check",
      sql`(${table.status} = 'revoked' and ${table.revokedAt} is not null) or (${table.status} <> 'revoked' and ${table.revokedAt} is null)`,
    ),
  ],
);

/**
 * Append-only owner audit trail. Writes go through the admin application only;
 * a database trigger rejects UPDATE/DELETE/TRUNCATE so history cannot be
 * rewritten even by a compromised server role. It never stores private chat,
 * recordings, memories or credentials.
 */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").notNull(),
    action: text("action").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason"),
    requestId: text("request_id"),
    beforeState: jsonb("before_state").$type<JsonObject>(),
    afterState: jsonb("after_state").$type<JsonObject>(),
    createdAt: createdAt(),
  },
  (table) => [
    index("admin_audit_log_created_idx").on(table.createdAt),
    index("admin_audit_log_target_idx").on(table.targetKind, table.targetId),
    index("admin_audit_log_actor_created_idx").on(
      table.actorUserId,
      table.createdAt,
    ),
    check(
      "admin_audit_log_action_check",
      sql`${table.action} in ('invitation.create', 'invitation.revoke', 'user.suspend', 'user.activate', 'user.delete', 'user.sessions_revoke', 'diagnostic.acknowledge', 'diagnostic.resolve')`,
    ),
    check(
      "admin_audit_log_target_kind_check",
      sql`${table.targetKind} in ('user', 'invitation', 'diagnostic_event')`,
    ),
    check(
      "admin_audit_log_target_id_check",
      sql`length(trim(${table.targetId})) between 1 and 200`,
    ),
  ],
);
