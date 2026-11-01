import type { AdminAuditEntry } from "../domain/admin-audit";
import type { AdminAuditRepository } from "../repositories/admin-audit-repository";

/**
 * Writes one owner audit entry. Callers pass only small, non-sensitive state
 * summaries; private chat, recordings, memories and credentials must never be
 * included.
 */
export function recordAdminAudit(
  repository: AdminAuditRepository,
  entry: AdminAuditEntry,
): Promise<void> {
  return repository.record(entry);
}

/**
 * Best-effort audit write used after a management action has already committed.
 *
 * The audit table and the affected business tables belong to different modules,
 * so the current Alpha records the audit immediately after the business write
 * rather than inside its transaction. A failure is reported to the server log
 * (without user data) and to the caller so the API can surface a retryable
 * warning, but it never rewrites the already-applied business result.
 *
 * Known limitation (documented in the ACCT-ADMIN-001 handoff): a crash between
 * the business write and this call can lose the audit row. Moving the audit
 * insert into the same transaction requires a shared unit-of-work and is a
 * follow-up task, not a silent guarantee.
 */
export async function recordAdminAuditSafely(
  repository: AdminAuditRepository,
  entry: AdminAuditEntry,
): Promise<boolean> {
  try {
    await recordAdminAudit(repository, entry);
    return true;
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    console.error(
      `[admin-audit] failed to record action=${entry.action} targetKind=${entry.targetKind} error=${name}`,
    );
    return false;
  }
}
