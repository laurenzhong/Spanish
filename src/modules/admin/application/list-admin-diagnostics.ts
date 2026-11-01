import type { PageInfo } from "@/src/shared/contracts/v1/api-contract";

import {
  decodeAdminCursorOrThrow,
  type DiagnosticEventType,
  type DiagnosticSeverity,
  type DiagnosticStatus,
} from "../domain/admin-console";
import type { AdminReadRepository } from "../repositories/admin-read-repository";
import type { AdminDiagnosticsDataDto } from "../schemas/admin-console";
import { toDiagnosticEventDto } from "./admin-projection";

export type ListAdminDiagnosticsInput = Readonly<{
  status?: DiagnosticStatus;
  severity?: DiagnosticSeverity;
  eventType?: DiagnosticEventType;
  /** ISO timestamp produced by the query schema. */
  since?: string;
  cursor?: string;
  limit: number;
}>;

export type ListAdminDiagnosticsResult = Readonly<{
  data: AdminDiagnosticsDataDto;
  page: PageInfo;
}>;

/**
 * Diagnostic alert list for `/admin/diagnostics` (design §5.4).
 *
 * Only the event type, severity, status, error type and timestamps are returned;
 * event metadata can carry internal correlation ids and is never projected.
 * The aggregate block always covers every event so the console can show alert
 * totals next to a filtered page.
 */
export async function listAdminDiagnostics(
  repository: AdminReadRepository,
  input: ListAdminDiagnosticsInput,
): Promise<ListAdminDiagnosticsResult> {
  const cursor = decodeAdminCursorOrThrow(input.cursor);
  const since = input.since ? new Date(input.since) : undefined;
  const page = await repository.listDiagnostics({
    status: input.status,
    severity: input.severity,
    eventType: input.eventType,
    since,
    cursor: cursor ?? undefined,
    limit: input.limit,
  });
  return {
    data: {
      events: page.events.map(toDiagnosticEventDto),
      aggregate: {
        open: page.aggregate.open,
        acknowledged: page.aggregate.acknowledged,
        resolved: page.aggregate.resolved,
        byEventType: page.aggregate.byEventType.map((entry) => ({
          eventType: entry.eventType,
          open: entry.open,
          total: entry.total,
        })),
        storageCleanupFailed: page.aggregate.storageCleanupFailed,
      },
    },
    page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
  };
}
