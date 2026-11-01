import {
  diagnosticAuditActionForStatus,
  isLegalDiagnosticTransition,
} from "../domain/admin-console";
import { AdminActionError } from "../errors";
import type { AdminAuditRepository } from "../repositories/admin-audit-repository";
import type { AdminReadRepository } from "../repositories/admin-read-repository";
import type { AdminDiagnosticUpdateDataDto } from "../schemas/admin-console";
import { toDiagnosticEventDto } from "./admin-projection";
import { recordAdminAuditSafely } from "./record-admin-audit";

export type UpdateDiagnosticStatusInput = Readonly<{
  eventId: string;
  status: "acknowledged" | "resolved";
  reason: string;
  /** Internal owner UUID for the audit actor column (never returned by the API). */
  actorUserId: string;
  requestId: string;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}>;

/**
 * Owner triage for a diagnostic event: acknowledge or resolve.
 *
 * This is the only write of the regulatory-console slice besides the audit row.
 * Transitions are strict (`open -> acknowledged -> resolved`), an invalid
 * transition is `409 CONFLICT`, and a missing event is `404 RESOURCE_NOT_FOUND`.
 * The audit write is best-effort (shared `recordAdminAuditSafely`): a failure is
 * reported via `auditRecorded: false` and never rewrites the triage result.
 */
export async function updateDiagnosticStatus(
  repository: AdminReadRepository,
  auditRepository: AdminAuditRepository,
  input: UpdateDiagnosticStatusInput,
): Promise<AdminDiagnosticUpdateDataDto> {
  const now = input.now ?? new Date();
  const existing = await repository.findDiagnosticEvent(input.eventId);
  if (!existing) {
    throw new AdminActionError(
      "RESOURCE_NOT_FOUND",
      "The diagnostic event was not found.",
      404,
    );
  }
  if (!isLegalDiagnosticTransition(existing.status, input.status)) {
    throw new AdminActionError(
      "CONFLICT",
      "The diagnostic event cannot be transitioned to the requested status.",
      409,
    );
  }
  const updated = await repository.transitionDiagnosticEvent({
    eventId: input.eventId,
    status: input.status,
    now,
  });
  if (!updated) {
    // Another request changed the status between the read and the update; the
    // condition is stable and retryable only after a refresh of the page.
    throw new AdminActionError(
      "CONFLICT",
      "The diagnostic event was changed by another request.",
      409,
    );
  }
  const auditRecorded = await recordAdminAuditSafely(auditRepository, {
    actorUserId: input.actorUserId,
    action: diagnosticAuditActionForStatus(input.status),
    targetKind: "diagnostic_event",
    targetId: input.eventId,
    reason: input.reason,
    requestId: input.requestId,
    beforeState: { status: existing.status },
    afterState: { status: updated.status },
  });
  return { event: toDiagnosticEventDto(updated), auditRecorded };
}
