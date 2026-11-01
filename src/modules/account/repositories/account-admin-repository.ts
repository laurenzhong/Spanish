import type {
  AccountRole,
  AccountStatus,
} from "../domain/account-admin";
import type { InvitationStatus } from "../domain/invitation";
import type { ListCursor } from "../domain/pagination-cursor";

/**
 * Repository port for the account-management slice (ACCT-ADMIN-001).
 *
 * The account module owns the `account_invitations` ledger and the
 * role/status/deletion columns of `profiles`; this port is the only place that
 * touches them. Application use cases define transaction boundaries; the Drizzle
 * adapter below never makes business decisions.
 *
 * Every state transition is a conditional UPDATE (compare-and-set) so concurrent
 * redemptions and retried management actions cannot produce duplicate side
 * effects.
 */

export type AccountInvitationRecord = Readonly<{
  id: string;
  email: string;
  role: AccountRole;
  status: InvitationStatus;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
  acceptedUserId: string | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  failedAt: Date | null;
  failureCode: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AccountAdminUser = Readonly<{
  userId: string;
  publicUid: string;
  displayName: string | null;
  role: AccountRole;
  status: AccountStatus;
  deletionRequestedAt: Date | null;
  createdAt: Date;
}>;

export type CreateInvitationRecordInput = Readonly<{
  email: string;
  role: AccountRole;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
  notes: string | null;
}>;

export type ListInvitationsOptions = Readonly<{
  status?: InvitationStatus;
  limit: number;
  cursor?: ListCursor;
}>;

export type ListInvitationsResult = Readonly<{
  rows: readonly AccountInvitationRecord[];
  hasMore: boolean;
}>;

export type RedeemInvitationCasInput = Readonly<{
  tokenHash: string;
  email: string;
  now: Date;
}>;

export interface AccountAdminRepository {
  transaction<T>(
    work: (repository: AccountAdminRepository) => Promise<T>,
  ): Promise<T>;

  createInvitation(
    input: CreateInvitationRecordInput,
  ): Promise<AccountInvitationRecord | "conflict">;
  findInvitationById(invitationId: string): Promise<AccountInvitationRecord | null>;
  findInvitationByTokenHash(
    tokenHash: string,
  ): Promise<AccountInvitationRecord | null>;
  listInvitations(
    options: ListInvitationsOptions,
  ): Promise<ListInvitationsResult>;
  /** Lazily mark unexpired-pending invitations whose deadline has passed. */
  expireStaleInvitations(now: Date): Promise<number>;
  /** Reconcile `redeeming` rows left behind by a crashed redemption. */
  reconcileStaleRedemptions(now: Date): Promise<number>;

  /** Atomic `pending -> redeeming` with email + expiry re-check inside the UPDATE. */
  markInvitationRedeeming(
    input: RedeemInvitationCasInput,
  ): Promise<AccountInvitationRecord | null>;
  /** Atomic `redeeming -> accepted`. */
  markInvitationAccepted(
    invitationId: string,
    acceptedUserId: string,
    now: Date,
  ): Promise<AccountInvitationRecord | null>;
  /** Atomic `pending|redeeming -> failed` with the failure marker fields. */
  markInvitationFailed(
    invitationId: string,
    failureCode: string,
    now: Date,
  ): Promise<AccountInvitationRecord | null>;
  /** Atomic `pending -> revoked`. */
  revokeInvitation(
    invitationId: string,
    now: Date,
  ): Promise<AccountInvitationRecord | null>;

  findUserByPublicUid(publicUid: string): Promise<AccountAdminUser | null>;
  findUserByUserId(userId: string): Promise<AccountAdminUser | null>;
  isPublicUidReserved(publicUid: string): Promise<boolean>;
  countOwners(): Promise<number>;

  /**
   * Set the invited profile's role and ensure it is active after the Auth user
   * was created. Returns false when the trigger-created profile is missing.
   */
  setInvitedProfile(
    userId: string,
    role: AccountRole,
    now: Date,
  ): Promise<boolean>;
  /** Conditional status write; false means the row was already in that state. */
  updateAccountStatus(
    userId: string,
    status: AccountStatus,
    now: Date,
  ): Promise<boolean>;
  /**
   * Mark the account for deletion and block it immediately. Idempotent: a retry
   * keeps the original `deletion_requested_at` and re-asserts `suspended`.
   */
  markDeletionRequested(
    userId: string,
    now: Date,
  ): Promise<AccountAdminUser | null>;
}
