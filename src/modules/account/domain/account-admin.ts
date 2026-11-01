/**
 * Account role/status and account-management rules (ACCT-ADMIN-001, ADR-0021).
 *
 * This module is pure TypeScript: no IO, no Next.js, no Drizzle and no
 * Supabase. Application use cases own the transaction/provider boundaries; this
 * file only decides what a legal transition looks like and which management
 * actions must be refused.
 */

export const ACCOUNT_ROLES = ["owner", "member"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const ACCOUNT_STATUSES = ["active", "suspended"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_REASON_MIN_LENGTH = 4;
export const ACCOUNT_REASON_MAX_LENGTH = 500;

export function isAccountRole(value: unknown): value is AccountRole {
  return ACCOUNT_ROLES.some((role) => role === value);
}

export function isAccountStatus(value: unknown): value is AccountStatus {
  return ACCOUNT_STATUSES.some((status) => status === value);
}

/**
 * Management reasons are mandatory and bounded. The trimmed value is what gets
 * stored in the audit trail; callers must never put email addresses, invitation
 * codes or chat content in it.
 */
export function normalizeAccountReason(input: string): string {
  const reason = input.trim();
  if (
    reason.length < ACCOUNT_REASON_MIN_LENGTH ||
    reason.length > ACCOUNT_REASON_MAX_LENGTH
  ) {
    throw new Error("invalid-account-reason");
  }
  return reason;
}

export function isValidAccountReason(input: string): boolean {
  try {
    normalizeAccountReason(input);
    return true;
  } catch {
    return false;
  }
}

export type AccountStatusChangeConflict = "self" | "last-owner";

export type AccountStatusChangePlan =
  | Readonly<{ kind: "change"; from: AccountStatus; to: AccountStatus }>
  | Readonly<{ kind: "noop"; status: AccountStatus }>
  | Readonly<{ kind: "conflict"; reason: AccountStatusChangeConflict }>;

export type AccountTarget = Readonly<{
  userId: string;
  role: AccountRole;
  status: AccountStatus;
}>;

/**
 * Decide whether an owner may move an account to `nextStatus`.
 *
 * - Suspending yourself is refused so an owner cannot lock themselves out.
 * - Suspending the last remaining owner is refused so the owner-only console
 *   cannot be left without an administrator (`fail-closed`).
 * - Repeating the current status is a no-op; the caller may still reconcile the
 *   Supabase ban state for idempotent retries.
 */
export function planAccountStatusChange(input: {
  actorUserId: string;
  target: AccountTarget;
  nextStatus: AccountStatus;
  ownerCount: number;
}): AccountStatusChangePlan {
  const { actorUserId, target, nextStatus, ownerCount } = input;
  if (target.status === nextStatus) {
    return { kind: "noop", status: nextStatus };
  }
  if (nextStatus === "suspended") {
    if (target.userId === actorUserId) {
      return { kind: "conflict", reason: "self" };
    }
    if (target.role === "owner" && ownerCount <= 1) {
      return { kind: "conflict", reason: "last-owner" };
    }
  }
  return { kind: "change", from: target.status, to: nextStatus };
}

/** Self-service deletion confirmation phrase (`DELETE /api/v1/me/account`). */
export const SELF_ACCOUNT_DELETION_CONFIRMATION = "DELETE_MY_ACCOUNT" as const;

/** Owner-initiated deletion confirmation phrase: `DELETE <publicUid>`. */
export function ownerAccountDeletionConfirmation(publicUid: string): string {
  return `DELETE ${publicUid}`;
}

export function isOwnerAccountDeletionConfirmation(
  confirmation: string,
  publicUid: string,
): boolean {
  return confirmation === ownerAccountDeletionConfirmation(publicUid);
}

export type AccountDeletionConflict = "self" | "last-owner";

export type OwnerAccountDeletionPlan =
  | Readonly<{ kind: "allowed" }>
  | Readonly<{ kind: "conflict"; reason: AccountDeletionConflict }>;

/**
 * Guard owner-initiated account deletion. Self-service deletion is a data right
 * and does not go through this rule; owners may not delete themselves "through
 * the console" nor delete the last remaining owner account.
 */
export function planOwnerAccountDeletion(input: {
  actorUserId: string;
  targetUserId: string;
  targetRole: AccountRole;
  ownerCount: number;
}): OwnerAccountDeletionPlan {
  if (input.actorUserId === input.targetUserId) {
    return { kind: "conflict", reason: "self" };
  }
  if (input.targetRole === "owner" && input.ownerCount <= 1) {
    return { kind: "conflict", reason: "last-owner" };
  }
  return { kind: "allowed" };
}
