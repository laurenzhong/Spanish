import {
  recordAdminAuditSafely,
  type AdminAuditRepository,
} from "@/src/modules/admin";
import {
  clearAccountBusinessData,
  removeAccountProfile,
  type PrivacyRepository,
  type StorageObjectDeleter,
} from "@/src/modules/privacy";
import type { DiagnosticEventWriter } from "@/src/shared/observability";

import { AccountActionError } from "../errors";
import {
  isOwnerAccountDeletionConfirmation,
  normalizeAccountReason,
  planOwnerAccountDeletion,
} from "../domain/account-admin";
import type {
  AccountAdminRepository,
  AccountAdminUser,
} from "../repositories";
import type { AccountProvisioner } from "../providers";
import type { AccountDeletionResponseDto } from "../schemas";
import { systemAccountClock, type AccountClock } from "./clock";

const SELF_DELETION_AUDIT_REASON = "Self-service account deletion.";

export type AccountDeletionDeps = Readonly<{
  repository: AccountAdminRepository;
  auditRepository: AdminAuditRepository;
  privacyRepository: PrivacyRepository;
  storageDeleter: StorageObjectDeleter;
  provisioner: AccountProvisioner | null;
  diagnostics?: DiagnosticEventWriter;
  clock?: AccountClock;
}>;

export type DeleteOwnAccountInput = Readonly<{
  userId: string;
  requestId: string;
}>;

export type DeleteAccountAsOwnerInput = Readonly<{
  ownerId: string;
  requestId: string;
  publicUid: string;
  confirmation: string;
  reason: string;
}>;

function provisioningFailed(): AccountActionError {
  return new AccountActionError(
    "ACCOUNT_PROVISIONING_FAILED",
    "Account deletion did not finish. The deletion marker was kept and the action can be retried.",
    503,
    true,
  );
}

function conflict(): AccountActionError {
  return new AccountActionError(
    "ACCOUNT_STATE_CONFLICT",
    "The requested account deletion is not allowed.",
    409,
  );
}

/**
 * Shared account-deletion orchestration for self-service and owner-initiated
 * deletion (ACCT-ADMIN-001, ADR-0021).
 *
 * Order:
 *   1. mark `deletion_requested_at` + `suspended` (blocks the account at the
 *      shared identity gate immediately);
 *   2. clear the business data but keep the profile row as a tombstone, so an
 *      interrupted deletion remains discoverable and retryable by the owner;
 *   3. delete the Supabase Auth user (idempotent);
 *   4. delete the profile tombstone (cascade) and write the `user.delete` audit.
 *
 * A failure between steps 2 and 4 keeps both the deletion marker and the
 * tombstone profile; retrying resolves the same target again and continues.
 * No partial result is reported as success.
 */
async function runAccountDeletion(
  deps: AccountDeletionDeps,
  target: AccountAdminUser,
  context: Readonly<{
    actorUserId: string;
    requestId: string;
    reason: string;
  }>,
  now: Date,
): Promise<AccountDeletionResponseDto> {
  const provisioner = deps.provisioner;
  if (!provisioner) throw provisioningFailed();

  const marked = await deps.repository.markDeletionRequested(target.userId, now);
  if (!marked) {
    // The profile disappeared between resolution and the marker write: the
    // account was already deleted by a concurrent request.
    return { deleted: true, alreadyDeleted: true };
  }

  let cleared;
  try {
    cleared = await clearAccountBusinessData(
      deps.privacyRepository,
      deps.storageDeleter,
      target.userId,
      { diagnostics: deps.diagnostics, requestId: context.requestId },
    );
  } catch {
    // Marker + tombstone remain; the account is blocked and the action can be
    // retried once the database/storage dependency recovers.
    throw provisioningFailed();
  }
  if (cleared.alreadyDeleted) {
    return { deleted: true, alreadyDeleted: true };
  }
  try {
    await provisioner.deleteUser(target.userId);
  } catch {
    // The business data was cleared and the profile tombstone still carries
    // `deletion_requested_at`; retrying finishes the Auth deletion.
    throw provisioningFailed();
  }

  let profileRemoved: boolean;
  try {
    profileRemoved = await removeAccountProfile(deps.privacyRepository, target.userId);
  } catch {
    throw provisioningFailed();
  }

  // A concurrent retry may have removed the tombstone after Auth deletion
  // succeeded. Treat that race as an idempotent success and avoid writing a
  // duplicate audit row; the other request owns the successful audit.
  if (!profileRemoved) return { deleted: true, alreadyDeleted: true };

  await recordAdminAuditSafely(deps.auditRepository, {
    actorUserId: context.actorUserId,
    action: "user.delete",
    targetKind: "user",
    targetId: target.publicUid,
    reason: context.reason,
    requestId: context.requestId,
    beforeState: {
      accountStatus: "suspended",
      role: target.role,
      deletionRequested: true,
    },
    afterState: { deleted: true },
  });

  return { deleted: true, alreadyDeleted: false };
}

/** `DELETE /api/v1/me/account` — the caller's own account, a data right. */
export async function deleteOwnAccount(
  deps: AccountDeletionDeps,
  input: DeleteOwnAccountInput,
): Promise<AccountDeletionResponseDto> {
  const now = (deps.clock ?? systemAccountClock)();
  const target = await deps.repository.findUserByUserId(input.userId);
  if (!target) {
    // Idempotent retry after a successful (or concurrent) deletion.
    return { deleted: true, alreadyDeleted: true };
  }
  return runAccountDeletion(
    deps,
    target,
    {
      actorUserId: input.userId,
      requestId: input.requestId,
      reason: SELF_DELETION_AUDIT_REASON,
    },
    now,
  );
}

/** `POST /api/v1/admin/users/:publicUid/deletion` — owner-initiated deletion. */
export async function deleteAccountAsOwner(
  deps: AccountDeletionDeps,
  input: DeleteAccountAsOwnerInput,
): Promise<AccountDeletionResponseDto> {
  let reason: string;
  try {
    reason = normalizeAccountReason(input.reason);
  } catch {
    throw new AccountActionError(
      "VALIDATION_FAILED",
      "A reason between 4 and 500 characters is required.",
      400,
    );
  }

  const now = (deps.clock ?? systemAccountClock)();
  const target = await deps.repository.findUserByPublicUid(input.publicUid);
  if (!target) {
    if (await deps.repository.isPublicUidReserved(input.publicUid)) {
      return { deleted: true, alreadyDeleted: true };
    }
    throw new AccountActionError(
      "RESOURCE_NOT_FOUND",
      "The user account was not found.",
      404,
    );
  }

  if (!isOwnerAccountDeletionConfirmation(input.confirmation, target.publicUid)) {
    throw new AccountActionError(
      "VALIDATION_FAILED",
      "The deletion confirmation phrase is invalid.",
      400,
    );
  }

  // Guards apply to starting a deletion; a retry of an already-marked deletion
  // must be allowed to finish even if the account was the last owner.
  if (target.deletionRequestedAt === null) {
    const ownerCount =
      target.role === "owner" ? await deps.repository.countOwners() : 0;
    const plan = planOwnerAccountDeletion({
      actorUserId: input.ownerId,
      targetUserId: target.userId,
      targetRole: target.role,
      ownerCount,
    });
    if (plan.kind === "conflict") throw conflict();
  }

  return runAccountDeletion(
    deps,
    target,
    { actorUserId: input.ownerId, requestId: input.requestId, reason },
    now,
  );
}
