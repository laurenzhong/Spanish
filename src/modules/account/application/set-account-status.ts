import {
  recordAdminAuditSafely,
  type AdminAuditRepository,
} from "@/src/modules/admin";

import { AccountActionError } from "../errors";
import {
  normalizeAccountReason,
  planAccountStatusChange,
} from "../domain/account-admin";
import type { AccountAdminRepository } from "../repositories";
import type { AccountProvisioner } from "../providers";
import type { AccountStatusResponseDto } from "../schemas";
import { systemAccountClock, type AccountClock } from "./clock";
import { toAdminUserSummary } from "./dto";

export type SetAccountStatusDeps = Readonly<{
  repository: AccountAdminRepository;
  auditRepository: AdminAuditRepository;
  provisioner: AccountProvisioner | null;
  clock?: AccountClock;
}>;

export type SetAccountStatusInput = Readonly<{
  ownerId: string;
  requestId: string;
  publicUid: string;
  status: "active" | "suspended";
  reason: string;
}>;

function conflict(): AccountActionError {
  return new AccountActionError(
    "ACCOUNT_STATE_CONFLICT",
    "The requested account state change is not allowed.",
    409,
  );
}

function provisioningFailed(): AccountActionError {
  return new AccountActionError(
    "ACCOUNT_PROVISIONING_FAILED",
    "The account state was saved but the Auth service call failed. Retry the request.",
    503,
    true,
  );
}

/**
 * Owner suspension/activation.
 *
 * Order guarantees a blocked account on every partial failure:
 * - suspend: database `suspended` first (the shared identity gate blocks all
 *   product/API access immediately), then the Supabase ban. A ban failure
 *   returns a retryable 503; the database state still blocks access.
 * - activate: unban first, then database `active`. An unban failure leaves the
 *   database `suspended`, so the account stays blocked.
 *
 * Repeating the end state is idempotent: a retried suspend re-asserts the ban
 * without rewriting the audit trail, so a retry after a provider failure
 * converges without duplicate audit rows.
 */
export async function setAccountStatus(
  deps: SetAccountStatusDeps,
  input: SetAccountStatusInput,
): Promise<AccountStatusResponseDto> {
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

  const target = await deps.repository.findUserByPublicUid(input.publicUid);
  if (!target) {
    throw new AccountActionError(
      "RESOURCE_NOT_FOUND",
      "The user account was not found.",
      404,
    );
  }

  const ownerCount =
    target.role === "owner" ? await deps.repository.countOwners() : 0;
  const plan = planAccountStatusChange({
    actorUserId: input.ownerId,
    target: { userId: target.userId, role: target.role, status: target.status },
    nextStatus: input.status,
    ownerCount,
  });
  if (plan.kind === "conflict") throw conflict();

  const provisioner = deps.provisioner;
  if (!provisioner) throw provisioningFailed();

  const now = (deps.clock ?? systemAccountClock)();

  if (plan.kind === "noop") {
    // Reconcile only the safe direction: a repeated suspend re-asserts the ban.
    // A repeated activate performs no external call because the unban already
    // precedes the database transition.
    if (input.status === "suspended") {
      try {
        await provisioner.banUser(target.userId);
      } catch {
        throw provisioningFailed();
      }
    }
    return { user: toAdminUserSummary(target) };
  }

  if (plan.to === "suspended") {
    const changed = await deps.repository.updateAccountStatus(
      target.userId,
      "suspended",
      now,
    );
    const afterWrite = await deps.repository.findUserByUserId(target.userId);
    if (!afterWrite || (changed === false && afterWrite.status !== "suspended")) {
      throw conflict();
    }
    await recordAdminAuditSafely(deps.auditRepository, {
      actorUserId: input.ownerId,
      action: "user.suspend",
      targetKind: "user",
      targetId: target.publicUid,
      reason,
      requestId: input.requestId,
      beforeState: { accountStatus: target.status, role: target.role },
      afterState: { accountStatus: "suspended", role: target.role },
    });
    try {
      await provisioner.banUser(target.userId);
    } catch {
      throw provisioningFailed();
    }
    return { user: toAdminUserSummary(afterWrite) };
  }

  // Activate: unban before writing `active` so a provider failure keeps the
  // account blocked.
  try {
    await provisioner.unbanUser(target.userId);
  } catch {
    throw provisioningFailed();
  }
  const changed = await deps.repository.updateAccountStatus(
    target.userId,
    "active",
    now,
  );
  const afterWrite = await deps.repository.findUserByUserId(target.userId);
  if (!afterWrite || (changed === false && afterWrite.status !== "active")) {
    // Best effort: restore the ban if the database write lost a race, so the
    // account cannot be used while it is still suspended.
    try {
      await provisioner.banUser(target.userId);
    } catch {
      // State stays blocked by the database gate; the retryable conflict tells
      // the owner to check the account.
    }
    throw conflict();
  }
  await recordAdminAuditSafely(deps.auditRepository, {
    actorUserId: input.ownerId,
    action: "user.activate",
    targetKind: "user",
    targetId: target.publicUid,
    reason,
    requestId: input.requestId,
    beforeState: { accountStatus: target.status, role: target.role },
    afterState: { accountStatus: "active", role: target.role },
  });
  return { user: toAdminUserSummary(afterWrite) };
}
