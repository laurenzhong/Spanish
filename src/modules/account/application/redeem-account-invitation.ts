import { AccountActionError } from "../errors";
import {
  evaluateInvitationRedemption,
  hashInvitationCode,
  normalizeInvitationEmail,
} from "../domain/invitation";
import type { AccountAdminRepository } from "../repositories";
import type { AccountProvisioner } from "../providers";
import type {
  RedeemInvitationRequest,
  RedeemInvitationResponseDto,
} from "../schemas";
import { systemAccountClock, type AccountClock } from "./clock";

export type RedeemAccountInvitationDeps = Readonly<{
  repository: AccountAdminRepository;
  provisioner: AccountProvisioner | null;
  /** `ACCOUNT_INVITATIONS_ENABLED === "1"`; otherwise the flow is fail-closed. */
  registrationEnabled: boolean;
  clock?: AccountClock;
}>;

function invalidInvitation(): AccountActionError {
  // Every invalid/expired/revoked/used/mismatched invitation returns this same
  // error so the public endpoint cannot enumerate accounts or invitation states.
  return new AccountActionError(
    "INVITATION_INVALID",
    "The invitation is invalid or has expired.",
    400,
  );
}

function provisioningFailed(): AccountActionError {
  return new AccountActionError(
    "ACCOUNT_PROVISIONING_FAILED",
    "Account provisioning failed. The owner must review the invitation.",
    503,
    true,
  );
}

async function markFailedSafely(
  repository: AccountAdminRepository,
  invitationId: string,
  failureCode: string,
  now: Date,
): Promise<void> {
  try {
    await repository.markInvitationFailed(invitationId, failureCode, now);
  } catch {
    // The invitation ledger write is best-effort here: the account is already
    // unusable and the owner reconciliation path reports the failure.
  }
}

/**
 * Redeem an invitation: atomic `pending -> redeeming` CAS, Supabase Auth user
 * creation, profile role/status sync, then `accepted`.
 *
 * Compensating action: if the Auth user was created but the profile/invitation
 * write failed, the new Auth user is deleted and the invitation is marked
 * `failed` (failure code `provisioning_partial`) so the owner can reconcile. A
 * failed compensation is reported through the same `failed` status and the
 * retryable `503 ACCOUNT_PROVISIONING_FAILED` response; the Auth user is never
 * silently left attached to a "successful" invitation.
 */
export async function redeemAccountInvitation(
  deps: RedeemAccountInvitationDeps,
  input: RedeemInvitationRequest,
): Promise<RedeemInvitationResponseDto> {
  if (!deps.registrationEnabled) {
    throw new AccountActionError(
      "REGISTRATION_CLOSED",
      "Invitation registration is not enabled.",
      403,
    );
  }

  const email = normalizeInvitationEmail(input.email);
  if (!email) throw invalidInvitation();

  let tokenHash: string;
  try {
    tokenHash = hashInvitationCode(input.code);
  } catch {
    throw invalidInvitation();
  }

  // Fail closed before consuming the single-use invitation: a missing server
  // secret key must leave the invitation pending so it can be redeemed after the
  // operator fixes the configuration.
  const provisioner = deps.provisioner;
  if (!provisioner) throw provisioningFailed();

  const now = (deps.clock ?? systemAccountClock)();

  // Pre-check only for a fast, deterministic rejection; the CAS below is the
  // authoritative concurrency boundary.
  const existing = await deps.repository.findInvitationByTokenHash(tokenHash);
  if (!existing) throw invalidInvitation();
  if (
    evaluateInvitationRedemption(existing, { email, now }).kind === "invalid"
  ) {
    throw invalidInvitation();
  }

  const invitation = await deps.repository.markInvitationRedeeming({
    tokenHash,
    email,
    now,
  });
  if (!invitation) throw invalidInvitation();

  let createdUserId: string;
  try {
    const created = await provisioner.createConfirmedUser({ email });
    createdUserId = created.userId;
  } catch {
    await markFailedSafely(
      deps.repository,
      invitation.id,
      "provisioning_failed",
      now,
    );
    throw provisioningFailed();
  }

  try {
    await deps.repository.transaction(async (transaction) => {
      const profileReady = await transaction.setInvitedProfile(
        createdUserId,
        invitation.role,
        now,
      );
      if (!profileReady) throw new Error("invitation-profile-missing");
      const accepted = await transaction.markInvitationAccepted(
        invitation.id,
        createdUserId,
        now,
      );
      if (!accepted) throw new Error("invitation-not-redeeming");
    });
  } catch {
    // Compensation: the Auth user may exist while the profile/invitation write
    // did not commit. Delete it; the invitation becomes `failed` either way.
    try {
      await provisioner.deleteUser(createdUserId);
    } catch {
      // Leave the orphaned Auth user for the owner console reconciliation; the
      // invitation is still marked failed below and the API returns a retryable
      // provisioning error rather than pretending success.
    }
    await markFailedSafely(
      deps.repository,
      invitation.id,
      "provisioning_partial",
      now,
    );
    throw provisioningFailed();
  }

  return { status: "ready", email };
}
