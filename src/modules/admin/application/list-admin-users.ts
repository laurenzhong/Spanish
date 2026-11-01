import type { AccountRole, AccountStatus } from "@/src/shared/auth/account-access";
import type { PageInfo } from "@/src/shared/contracts/v1/api-contract";

import { decodeAdminCursorOrThrow } from "../domain/admin-console";
import type { AdminReadRepository } from "../repositories/admin-read-repository";
import type { AdminUserListDataDto } from "../schemas/admin-console";
import { toAdminUserSummary } from "./admin-projection";

export type ListAdminUsersInput = Readonly<{
  q?: string;
  status?: AccountStatus;
  role?: AccountRole;
  cursor?: string;
  limit: number;
}>;

export type ListAdminUsersResult = Readonly<{
  data: AdminUserListDataDto;
  page: PageInfo;
}>;

/**
 * Paginated user list for `/admin/users` (design §5.4).
 *
 * Search only covers the public UID and display name; the internal profile id is
 * used for aggregation joins but never returned. Counts are "学习摘要" counters,
 * not learning-capability facts.
 */
export async function listAdminUsers(
  repository: AdminReadRepository,
  input: ListAdminUsersInput,
): Promise<ListAdminUsersResult> {
  const cursor = decodeAdminCursorOrThrow(input.cursor);
  const page = await repository.listUsers({
    q: input.q,
    status: input.status,
    role: input.role,
    cursor: cursor ?? undefined,
    limit: input.limit,
  });
  const aggregates = await repository.loadUserAggregates(
    page.users.map((user) => user.id),
  );
  return {
    data: {
      users: page.users.map((user) =>
        toAdminUserSummary(user, aggregates.get(user.id)),
      ),
    },
    page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
  };
}
