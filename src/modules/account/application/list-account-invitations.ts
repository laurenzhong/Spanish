import { AccountActionError } from "../errors";
import {
  decodeListCursor,
  encodeListCursor,
} from "../domain/pagination-cursor";
import type { AccountAdminRepository } from "../repositories";
import type {
  InvitationListDto,
  ListInvitationsQuery,
} from "../schemas";
import { systemAccountClock, type AccountClock } from "./clock";
import { toInvitationSummary } from "./dto";

export type ListAccountInvitationsDeps = Readonly<{
  repository: AccountAdminRepository;
  clock?: AccountClock;
}>;

/**
 * Owner-facing invitation list. Reading performs the documented lazy
 * reconciliation: expired pending rows are marked `expired`, and `redeeming`
 * rows abandoned beyond the reconciliation window are marked `failed` so the
 * owner can re-invite. Plain email is never selected into the DTO.
 */
export async function listAccountInvitations(
  deps: ListAccountInvitationsDeps,
  query: ListInvitationsQuery,
): Promise<InvitationListDto> {
  const cursor = query.cursor ? decodeListCursor(query.cursor) : undefined;
  if (query.cursor && !cursor) {
    throw new AccountActionError(
      "VALIDATION_FAILED",
      "The pagination cursor is invalid.",
      400,
    );
  }

  const now = (deps.clock ?? systemAccountClock)();
  await deps.repository.expireStaleInvitations(now);
  await deps.repository.reconcileStaleRedemptions(now);

  const { rows, hasMore } = await deps.repository.listInvitations({
    ...(query.status ? { status: query.status } : {}),
    limit: query.limit,
    ...(cursor ? { cursor } : {}),
  });

  const lastRow = rows.at(-1);
  return {
    invitations: rows.map((row) => toInvitationSummary(row, now)),
    page: {
      nextCursor:
        hasMore && lastRow
          ? encodeListCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
          : null,
      hasMore,
    },
  };
}
