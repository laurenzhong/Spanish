import { randomBytes as nodeRandomBytes } from "node:crypto";

import {
  recordAdminAuditSafely,
  type AdminAuditRepository,
} from "@/src/modules/admin";

import { AccountActionError } from "../errors";
import {
  DEFAULT_INVITATION_TTL_HOURS,
  generateInvitationCode,
  hashInvitationCode,
  invitationExpiresAt,
  normalizeInvitationEmail,
} from "../domain/invitation";
import type { AccountAdminRepository } from "../repositories";
import type {
  CreateInvitationRequest,
  CreateInvitationResponseDto,
} from "../schemas";
import {
  systemAccountClock,
  type AccountClock,
  type RandomByteSource,
} from "./clock";
import { toInvitationSummary } from "./dto";

export type CreateAccountInvitationDeps = Readonly<{
  repository: AccountAdminRepository;
  auditRepository: AdminAuditRepository;
  /** `ACCOUNT_INVITATIONS_ENABLED === "1"`; otherwise the flow is fail-closed. */
  registrationEnabled: boolean;
  clock?: AccountClock;
  randomBytes?: RandomByteSource;
  defaultTtlHours?: number;
}>;

export type CreateAccountInvitationInput = CreateInvitationRequest &
  Readonly<{ ownerId: string; requestId: string }>;

/**
 * Create one single-use invitation. The plaintext code is returned exactly once
 * in this response; only its SHA-256 hash is persisted. The owner shares the
 * code out-of-band (no email is sent in this Alpha).
 */
export async function createAccountInvitation(
  deps: CreateAccountInvitationDeps,
  input: CreateAccountInvitationInput,
): Promise<CreateInvitationResponseDto> {
  if (!deps.registrationEnabled) {
    throw new AccountActionError(
      "REGISTRATION_CLOSED",
      "Invitation registration is not enabled.",
      403,
    );
  }

  const email = normalizeInvitationEmail(input.email);
  if (!email) {
    throw new AccountActionError(
      "VALIDATION_FAILED",
      "The invitation email is invalid.",
      400,
    );
  }

  const now = (deps.clock ?? systemAccountClock)();
  const ttlHours = input.expiresInHours ?? deps.defaultTtlHours ?? DEFAULT_INVITATION_TTL_HOURS;
  const role = input.role ?? "member";
  const bytes = (deps.randomBytes ?? nodeRandomBytes)(16);
  const code = generateInvitationCode(bytes);
  const tokenHash = hashInvitationCode(code);

  const created = await deps.repository.createInvitation({
    email,
    role,
    tokenHash,
    invitedByUserId: input.ownerId,
    expiresAt: invitationExpiresAt(now, ttlHours),
    notes: input.notes ?? null,
  });
  if (created === "conflict") {
    throw new AccountActionError(
      "INVITATION_CONFLICT",
      "An invitation for this email is already pending.",
      409,
    );
  }

  // Best-effort audit after the business write (documented Alpha limitation:
  // the audit row is not in the same transaction as the invitation insert).
  await recordAdminAuditSafely(deps.auditRepository, {
    actorUserId: input.ownerId,
    action: "invitation.create",
    targetKind: "invitation",
    targetId: created.id,
    reason: created.notes,
    requestId: input.requestId,
    beforeState: null,
    afterState: { status: created.status, role: created.role },
  });

  return {
    invitation: toInvitationSummary(created, now),
    code,
  };
}
