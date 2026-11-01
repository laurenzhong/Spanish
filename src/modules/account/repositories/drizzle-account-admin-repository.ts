import { and, count, desc, eq, gt, lt, ne, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";

import { isAccountRole, isAccountStatus } from "../domain/account-admin";
import {
  isInvitationStatus,
  REDEEM_RECONCILIATION_WINDOW_MS,
} from "../domain/invitation";
import type {
  AccountAdminRepository,
  AccountAdminUser,
  AccountInvitationRecord,
  CreateInvitationRecordInput,
  ListInvitationsOptions,
  ListInvitationsResult,
  RedeemInvitationCasInput,
} from "./account-admin-repository";

type AccountDatabase<TResult extends PgQueryResultHKT> = PgDatabase<
  TResult,
  typeof schema
>;

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== "object") return false;
    const candidate = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (candidate.code === UNIQUE_VIOLATION) return true;
    if (
      typeof candidate.message === "string" &&
      /duplicate key value|account_invitations_pending_email/iu.test(candidate.message)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function mapInvitation(
  row: typeof schema.accountInvitations.$inferSelect,
): AccountInvitationRecord {
  if (!isAccountRole(row.role) || !isInvitationStatus(row.status)) {
    throw new Error("corrupt-account-invitation-row");
  }
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    tokenHash: row.tokenHash,
    invitedByUserId: row.invitedByUserId,
    expiresAt: row.expiresAt,
    acceptedUserId: row.acceptedUserId,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    failedAt: row.failedAt,
    failureCode: row.failureCode,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapUser(
  row: Pick<
    typeof schema.profiles.$inferSelect,
    | "id"
    | "publicUid"
    | "displayName"
    | "role"
    | "accountStatus"
    | "deletionRequestedAt"
    | "createdAt"
  >,
): AccountAdminUser {
  if (!isAccountRole(row.role) || !isAccountStatus(row.accountStatus)) {
    throw new Error("corrupt-account-profile-row");
  }
  return {
    userId: row.id,
    publicUid: row.publicUid,
    displayName: row.displayName,
    role: row.role,
    status: row.accountStatus,
    deletionRequestedAt: row.deletionRequestedAt,
    createdAt: row.createdAt,
  };
}

const PROFILE_COLUMNS = {
  id: schema.profiles.id,
  publicUid: schema.profiles.publicUid,
  displayName: schema.profiles.displayName,
  role: schema.profiles.role,
  accountStatus: schema.profiles.accountStatus,
  deletionRequestedAt: schema.profiles.deletionRequestedAt,
  createdAt: schema.profiles.createdAt,
} as const;

export function createDrizzleAccountAdminRepository<
  TResult extends PgQueryResultHKT,
>(database: AccountDatabase<TResult>): AccountAdminRepository {
  const repository: AccountAdminRepository = {
    async transaction(work) {
      return database.transaction((transaction) =>
        work(createDrizzleAccountAdminRepository(transaction)),
      );
    },

    async createInvitation(input: CreateInvitationRecordInput) {
      try {
        const [row] = await database
          .insert(schema.accountInvitations)
          .values({
            email: input.email,
            role: input.role,
            status: "pending",
            tokenHash: input.tokenHash,
            invitedByUserId: input.invitedByUserId,
            expiresAt: input.expiresAt,
            notes: input.notes,
          })
          .returning();
        return row ? mapInvitation(row) : "conflict";
      } catch (error) {
        if (isUniqueViolation(error)) return "conflict";
        throw error;
      }
    },

    async findInvitationById(invitationId) {
      const [row] = await database
        .select()
        .from(schema.accountInvitations)
        .where(eq(schema.accountInvitations.id, invitationId))
        .limit(1);
      return row ? mapInvitation(row) : null;
    },

    async findInvitationByTokenHash(tokenHash) {
      const [row] = await database
        .select()
        .from(schema.accountInvitations)
        .where(eq(schema.accountInvitations.tokenHash, tokenHash))
        .limit(1);
      return row ? mapInvitation(row) : null;
    },

    async listInvitations(
      options: ListInvitationsOptions,
    ): Promise<ListInvitationsResult> {
      const conditions = [
        options.status
          ? eq(schema.accountInvitations.status, options.status)
          : undefined,
        options.cursor
          ? or(
              lt(schema.accountInvitations.createdAt, options.cursor.createdAt),
              and(
                eq(
                  schema.accountInvitations.createdAt,
                  options.cursor.createdAt,
                ),
                lt(schema.accountInvitations.id, options.cursor.id),
              ),
            )
          : undefined,
      ].filter((condition) => condition !== undefined);
      const rows = await database
        .select()
        .from(schema.accountInvitations)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          desc(schema.accountInvitations.createdAt),
          desc(schema.accountInvitations.id),
        )
        .limit(options.limit + 1);
      const hasMore = rows.length > options.limit;
      return {
        rows: rows.slice(0, options.limit).map(mapInvitation),
        hasMore,
      };
    },

    async expireStaleInvitations(now) {
      const expired = await database
        .update(schema.accountInvitations)
        .set({ status: "expired", updatedAt: now })
        .where(
          and(
            eq(schema.accountInvitations.status, "pending"),
            lt(schema.accountInvitations.expiresAt, now),
          ),
        )
        .returning({ id: schema.accountInvitations.id });
      return expired.length;
    },

    async reconcileStaleRedemptions(now) {
      const threshold = new Date(now.getTime() - REDEEM_RECONCILIATION_WINDOW_MS);
      const failed = await database
        .update(schema.accountInvitations)
        .set({
          status: "failed",
          failureCode: "redeem_timeout",
          failedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.accountInvitations.status, "redeeming"),
            lt(schema.accountInvitations.updatedAt, threshold),
          ),
        )
        .returning({ id: schema.accountInvitations.id });
      return failed.length;
    },

    async markInvitationRedeeming(input: RedeemInvitationCasInput) {
      const [row] = await database
        .update(schema.accountInvitations)
        .set({ status: "redeeming", updatedAt: input.now })
        .where(
          and(
            eq(schema.accountInvitations.tokenHash, input.tokenHash),
            eq(schema.accountInvitations.email, input.email),
            eq(schema.accountInvitations.status, "pending"),
            gt(schema.accountInvitations.expiresAt, input.now),
          ),
        )
        .returning();
      return row ? mapInvitation(row) : null;
    },

    async markInvitationAccepted(invitationId, acceptedUserId, now) {
      const [row] = await database
        .update(schema.accountInvitations)
        .set({
          status: "accepted",
          acceptedUserId,
          acceptedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.accountInvitations.id, invitationId),
            eq(schema.accountInvitations.status, "redeeming"),
          ),
        )
        .returning();
      return row ? mapInvitation(row) : null;
    },

    async markInvitationFailed(invitationId, failureCode, now) {
      const [row] = await database
        .update(schema.accountInvitations)
        .set({
          status: "failed",
          failureCode,
          failedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.accountInvitations.id, invitationId),
            or(
              eq(schema.accountInvitations.status, "pending"),
              eq(schema.accountInvitations.status, "redeeming"),
            ),
          ),
        )
        .returning();
      return row ? mapInvitation(row) : null;
    },

    async revokeInvitation(invitationId, now) {
      const [row] = await database
        .update(schema.accountInvitations)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.accountInvitations.id, invitationId),
            eq(schema.accountInvitations.status, "pending"),
          ),
        )
        .returning();
      return row ? mapInvitation(row) : null;
    },

    async findUserByPublicUid(publicUid) {
      const [row] = await database
        .select(PROFILE_COLUMNS)
        .from(schema.profiles)
        .where(eq(schema.profiles.publicUid, publicUid))
        .limit(1);
      return row ? mapUser(row) : null;
    },

    async findUserByUserId(userId) {
      const [row] = await database
        .select(PROFILE_COLUMNS)
        .from(schema.profiles)
        .where(eq(schema.profiles.id, userId))
        .limit(1);
      return row ? mapUser(row) : null;
    },

    async isPublicUidReserved(publicUid) {
      const [row] = await database
        .select({ publicUid: schema.reservedPublicUids.publicUid })
        .from(schema.reservedPublicUids)
        .where(eq(schema.reservedPublicUids.publicUid, publicUid))
        .limit(1);
      return row !== undefined;
    },

    async countOwners() {
      const [row] = await database
        .select({ value: count() })
        .from(schema.profiles)
        .where(eq(schema.profiles.role, "owner"));
      return Number(row?.value ?? 0);
    },

    async setInvitedProfile(userId, role, now) {
      const updated = await database
        .update(schema.profiles)
        .set({ role, accountStatus: "active", updatedAt: now })
        .where(eq(schema.profiles.id, userId))
        .returning({ id: schema.profiles.id });
      return updated.length > 0;
    },

    async updateAccountStatus(userId, status, now) {
      const updated = await database
        .update(schema.profiles)
        .set({ accountStatus: status, updatedAt: now })
        .where(
          and(
            eq(schema.profiles.id, userId),
            ne(schema.profiles.accountStatus, status),
          ),
        )
        .returning({ id: schema.profiles.id });
      return updated.length > 0;
    },

    async markDeletionRequested(userId, now) {
      const [row] = await database
        .update(schema.profiles)
        .set({
          // Keep the first-request timestamp idempotent while letting the
          // database bind its own timestamp. Passing a JavaScript Date inside
          // this nested SQL fragment breaks postgres.js parameter encoding on
          // the real PostgreSQL path (PGlite did not expose that difference).
          deletionRequestedAt: sql`coalesce(${schema.profiles.deletionRequestedAt}, now())`,
          accountStatus: "suspended",
          updatedAt: now,
        })
        .where(eq(schema.profiles.id, userId))
        .returning(PROFILE_COLUMNS);
      return row ? mapUser(row) : null;
    },
  };
  return repository;
}
