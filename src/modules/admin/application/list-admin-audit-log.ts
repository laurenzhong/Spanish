import type { PageInfo } from "@/src/shared/contracts/v1/api-contract";

import type {
  AdminAuditAction,
  AdminAuditTargetKind,
} from "../domain/admin-audit";
import { decodeAdminCursorOrThrow } from "../domain/admin-console";
import type { AdminReadRepository } from "../repositories/admin-read-repository";
import type { AdminAuditLogDataDto } from "../schemas/admin-console";
import { projectAdminAuditEntry } from "./admin-projection";

export type ListAdminAuditLogInput = Readonly<{
  action?: AdminAuditAction;
  targetKind?: AdminAuditTargetKind;
  cursor?: string;
  limit: number;
}>;

export type ListAdminAuditLogResult = Readonly<{
  data: AdminAuditLogDataDto;
  page: PageInfo;
}>;

/**
 * Append-only owner action log for `/admin/audit-log` (design §5.5).
 *
 * Actor ids are reduced to a label plus a short non-reversible reference; target
 * ids are resolved to a public UID, a masked invited email or a diagnostic event
 * type so no internal id (and no email plaintext) reaches the browser.
 */
export async function listAdminAuditLog(
  repository: AdminReadRepository,
  input: ListAdminAuditLogInput,
): Promise<ListAdminAuditLogResult> {
  const cursor = decodeAdminCursorOrThrow(input.cursor);
  const page = await repository.listAuditEntries({
    action: input.action,
    targetKind: input.targetKind,
    cursor: cursor ?? undefined,
    limit: input.limit,
  });
  const labels = await repository.resolveAuditTargetLabels(page.entries);
  return {
    data: {
      entries: page.entries.map((entry) =>
        projectAdminAuditEntry(
          entry,
          labels.get(`${entry.targetKind}:${entry.targetId}`) ?? null,
        ),
      ),
    },
    page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
  };
}
