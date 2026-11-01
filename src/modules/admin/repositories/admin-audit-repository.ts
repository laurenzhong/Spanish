import { and, desc, eq } from "drizzle-orm";

import type { Database } from "@/src/shared/db/client";
import { adminAuditLog } from "@/src/shared/db/schema";

import type {
  AdminAuditAction,
  AdminAuditEntry,
  AdminAuditTargetKind,
} from "../domain/admin-audit";

export type AdminAuditRecord = Readonly<{
  id: string;
  actorUserId: string;
  action: AdminAuditAction;
  targetKind: AdminAuditTargetKind;
  targetId: string;
  reason: string | null;
  requestId: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  createdAt: Date;
}>;

export type AdminAuditListFilters = Readonly<{
  action?: AdminAuditAction;
  targetKind?: AdminAuditTargetKind;
  targetId?: string;
  limit: number;
}>;

export interface AdminAuditRepository {
  record(entry: AdminAuditEntry): Promise<void>;
  list(filters: AdminAuditListFilters): Promise<readonly AdminAuditRecord[]>;
  listForTarget(
    targetKind: AdminAuditTargetKind,
    targetId: string,
    limit: number,
  ): Promise<readonly AdminAuditRecord[]>;
}

function toRecord(row: typeof adminAuditLog.$inferSelect): AdminAuditRecord {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    action: row.action as AdminAuditAction,
    targetKind: row.targetKind as AdminAuditTargetKind,
    targetId: row.targetId,
    reason: row.reason,
    requestId: row.requestId,
    beforeState: row.beforeState ?? null,
    afterState: row.afterState ?? null,
    createdAt: row.createdAt,
  };
}

export function createDrizzleAdminAuditRepository(
  database: Database,
): AdminAuditRepository {
  return {
    async record(entry) {
      await database.insert(adminAuditLog).values({
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetKind: entry.targetKind,
        targetId: entry.targetId,
        reason: entry.reason,
        requestId: entry.requestId,
        beforeState: entry.beforeState,
        afterState: entry.afterState,
      });
    },
    async list(filters) {
      const conditions = [
        filters.action ? eq(adminAuditLog.action, filters.action) : undefined,
        filters.targetKind
          ? eq(adminAuditLog.targetKind, filters.targetKind)
          : undefined,
        filters.targetId ? eq(adminAuditLog.targetId, filters.targetId) : undefined,
      ].filter((condition) => condition !== undefined);
      const rows = await database
        .select()
        .from(adminAuditLog)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(filters.limit);
      return rows.map(toRecord);
    },
    async listForTarget(targetKind, targetId, limit) {
      const rows = await database
        .select()
        .from(adminAuditLog)
        .where(
          and(
            eq(adminAuditLog.targetKind, targetKind),
            eq(adminAuditLog.targetId, targetId),
          ),
        )
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(limit);
      return rows.map(toRecord);
    },
  };
}
