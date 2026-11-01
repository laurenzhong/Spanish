export const ADMIN_AUDIT_ACTIONS = [
  "invitation.create",
  "invitation.revoke",
  "user.suspend",
  "user.activate",
  "user.delete",
  "user.sessions_revoke",
  "diagnostic.acknowledge",
  "diagnostic.resolve",
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export const ADMIN_AUDIT_TARGET_KINDS = [
  "user",
  "invitation",
  "diagnostic_event",
] as const;

export type AdminAuditTargetKind = (typeof ADMIN_AUDIT_TARGET_KINDS)[number];

export type AdminAuditEntry = Readonly<{
  actorUserId: string;
  action: AdminAuditAction;
  targetKind: AdminAuditTargetKind;
  targetId: string;
  reason: string | null;
  requestId: string | null;
  /** Small, non-sensitive state summaries only (status values, counts, roles). */
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
}>;
