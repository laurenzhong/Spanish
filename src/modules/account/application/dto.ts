import {
  maskInvitationEmail,
  resolveInvitationStatus,
} from "../domain/invitation";
import type {
  AdminUserSummaryDto,
  InvitationSummaryDto,
} from "../schemas";
import type {
  AccountAdminUser,
  AccountInvitationRecord,
} from "../repositories";

/**
 * Explicit DTO projections. Database rows (including `token_hash`, the plain
 * email and the invited-by user id) never leave the server; owner-facing
 * invitation projections only expose a masked email.
 */
export function toInvitationSummary(
  record: AccountInvitationRecord,
  now: Date,
): InvitationSummaryDto {
  const status = resolveInvitationStatus(record.status, record.expiresAt, now);
  return {
    id: record.id,
    emailMasked: maskInvitationEmail(record.email),
    role: record.role,
    status,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    acceptedAt: record.acceptedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    failureCode: record.failureCode,
  };
}

export function toAdminUserSummary(
  user: AccountAdminUser,
): AdminUserSummaryDto {
  return {
    publicUid: user.publicUid,
    displayName: user.displayName,
    role: user.role,
    accountStatus: user.status,
    deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
