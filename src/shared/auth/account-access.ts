import { eq } from "drizzle-orm";

import { getDatabase } from "@/src/shared/db/client";
import { profiles } from "@/src/shared/db/schema";

export type AccountRole = "owner" | "member";
export type AccountStatus = "active" | "suspended";

export type AccountAccess = Readonly<{
  role: AccountRole;
  status: AccountStatus;
  /** A deletion was requested: the account must stay blocked until it finishes. */
  deletionPending: boolean;
}>;

/**
 * Read the account access state that the shared identity gate needs.
 *
 * This is deliberately a single-column projection of `profiles` rather than a
 * business-module dependency: account role/status are part of the
 * authentication/authorization boundary (ACCT-ADMIN-001, ADR-0021). Profile
 * writes still go through the account module.
 *
 * Returns `null` when the row cannot be read (database not configured, missing
 * profile, or a transient database error). Callers must treat `null` as
 * "unknown": the identity remains usable because failing closed here would
 * lock every session out during a database outage, while every data-backed
 * request still depends on the same database and fails on its own.
 */
export async function readAccountAccess(
  userId: string,
): Promise<AccountAccess | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const [row] = await getDatabase()
      .select({
        role: profiles.role,
        status: profiles.accountStatus,
        deletionRequestedAt: profiles.deletionRequestedAt,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    if (!row) return null;
    if (row.role !== "owner" && row.role !== "member") return null;
    if (row.status !== "active" && row.status !== "suspended") return null;
    return {
      role: row.role,
      status: row.status,
      deletionPending: row.deletionRequestedAt !== null,
    };
  } catch {
    return null;
  }
}

/**
 * Any access state that must be treated as "not allowed to use the product".
 * Suspended accounts and accounts with an in-flight deletion both lose access
 * immediately; the latter also blocks a stale session from re-entering while
 * the auth user is being removed.
 */
export function isBlockedAccess(access: AccountAccess | null): boolean {
  return access?.status === "suspended" || access?.deletionPending === true;
}
