import { AdminActionError } from "../errors";
import { maskEmail, toIsoStringOrNull } from "../domain/admin-console";
import type { AdminReadRepository } from "../repositories/admin-read-repository";
import type {
  AdminInvitationSourceDto,
  AdminUserDetailDataDto,
} from "../schemas/admin-console";
import { projectAdminAuditEntry, toAdminUserSummary } from "./admin-projection";

export type GetAdminUserDetailInput = Readonly<{
  publicUid: string;
}>;

/** Recent audit entries shown on the user detail page. */
const RECENT_AUDIT_LIMIT = 10;

/**
 * User detail for `/admin/users/[publicUid]` (design §5.4).
 *
 * The URL key is always the public UID. The response adds aggregated learning
 * counters, the masked invitation source when the account came from an invite,
 * and the most recent audited owner actions for this account.
 */
export async function getAdminUserDetail(
  repository: AdminReadRepository,
  input: GetAdminUserDetailInput,
): Promise<AdminUserDetailDataDto> {
  const user = await repository.findUserByPublicUid(input.publicUid);
  if (!user) {
    throw new AdminActionError("RESOURCE_NOT_FOUND", "The user was not found.", 404);
  }
  const [aggregates, invitation, recentAudit] = await Promise.all([
    repository.loadUserAggregates([user.id]),
    repository.findUserInvitationSource(user.id),
    repository.listUserAuditEntries({
      userId: user.id,
      publicUid: user.publicUid,
      limit: RECENT_AUDIT_LIMIT,
    }),
  ]);
  const invitationDto: AdminInvitationSourceDto | null = invitation
    ? {
        invitationId: invitation.id,
        emailMasked: maskEmail(invitation.email),
        role: invitation.role,
        status: invitation.status as AdminInvitationSourceDto["status"],
        createdAt: invitation.createdAt.toISOString(),
        acceptedAt: toIsoStringOrNull(invitation.acceptedAt),
      }
    : null;
  return {
    user: toAdminUserSummary(user, aggregates.get(user.id)),
    invitation: invitationDto,
    recentAudit: recentAudit.map((entry) =>
      projectAdminAuditEntry(entry, user.publicUid),
    ),
  };
}
