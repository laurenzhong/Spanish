import {
  recordAdminAuditSafely,
  type AdminAuditRepository,
} from "@/src/modules/admin";

import { AccountActionError } from "../errors";
import { normalizeAccountReason } from "../domain/account-admin";
import type { AccountAdminRepository } from "../repositories";
import type { RevokeInvitationResponseDto } from "../schemas";
import { systemAccountClock, type AccountClock } from "./clock";
import { toInvitationSummary } from "./dto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type RevokeAccountInvitationDeps = Readonly<{
  repository: AccountAdminRepository;
  auditRepository: AdminAuditRepository;
  clock?: AccountClock;
}>;

export type RevokeAccountInvitationInput = Readonly<{
  ownerId: string;
  requestId: string;
  invitationId: string;
  reason: string;
}>;

export async function revokeAccountInvitation(
  deps: RevokeAccountInvitationDeps,
  input: RevokeAccountInvitationInput,
): Promise<RevokeInvitationResponseDto> {
  if (!UUID_PATTERN.test(input.invitationId)) {
    throw new AccountActionError(
      "VALIDATION_FAILED",
      "The invitation id is invalid.",
      400,
    );
  }
  let reason: string;
  try {
    reason = normalizeAccountReason(input.reason);
  } catch {
    throw new AccountActionError(
      "VALIDATION_FAILED",
      "A revocation reason between 4 and 500 characters is required.",
      400,
    );
  }

  const now = (deps.clock ?? systemAccountClock)();
  const current = await deps.repository.findInvitationById(input.invitationId);
  if (!current) {
    throw new AccountActionError(
      "RESOURCE_NOT_FOUND",
      "The invitation was not found.",
      404,
    );
  }

  const revoked = await deps.repository.revokeInvitation(input.invitationId, now);
  if (!revoked) {
    throw new AccountActionError(
      "INVITATION_CONFLICT",
      "Only a pending invitation can be revoked.",
      409,
    );
  }

  await recordAdminAuditSafely(deps.auditRepository, {
    actorUserId: input.ownerId,
    action: "invitation.revoke",
    targetKind: "invitation",
    targetId: revoked.id,
    reason,
    requestId: input.requestId,
    beforeState: { status: current.status },
    afterState: { status: revoked.status },
  });

  return { invitation: toInvitationSummary(revoked, now) };
}
