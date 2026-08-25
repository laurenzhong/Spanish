import { and, desc, eq, gte } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import {
  type DiagnosticEventInput,
  type DiagnosticEventRecord,
  sanitizeDiagnosticMetadata,
} from "@/src/shared/observability";
import type {
  DiagnosticEventFilters,
  DiagnosticEventRepository,
} from "./diagnostic-event-repository";

type DiagnosticDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

function toRecord(row: typeof schema.diagnosticEvents.$inferSelect): DiagnosticEventRecord {
  return {
    id: row.id,
    eventType: row.eventType as DiagnosticEventRecord["eventType"],
    severity: row.severity as DiagnosticEventRecord["severity"],
    status: row.status as DiagnosticEventRecord["status"],
    requestId: row.requestId,
    sessionId: row.sessionId,
    attemptId: row.attemptId,
    conversationId: row.conversationId,
    generationId: row.generationId,
    errorType: row.errorType,
    metadata: row.metadata,
    occurredAt: row.occurredAt,
  };
}

export function createDrizzleDiagnosticEventRepository<TResult extends PgQueryResultHKT>(
  database: DiagnosticDatabase<TResult>,
): DiagnosticEventRepository {
  return {
    async record(input: DiagnosticEventInput) {
      await database.insert(schema.diagnosticEvents).values({
        userId: input.userId ?? null,
        eventType: input.eventType,
        severity: input.severity,
        dedupeKey: input.dedupeKey,
        requestId: input.correlation?.requestId ?? null,
        sessionId: input.correlation?.sessionId ?? null,
        attemptId: input.correlation?.attemptId ?? null,
        conversationId: input.correlation?.conversationId ?? null,
        generationId: input.correlation?.generationId ?? null,
        errorType: input.errorType ?? null,
        metadata: sanitizeDiagnosticMetadata(input.metadata),
      }).onConflictDoNothing({ target: schema.diagnosticEvents.dedupeKey });
    },

    async list(filters: DiagnosticEventFilters = {}) {
      const conditions = [];
      if (filters.eventType) conditions.push(eq(schema.diagnosticEvents.eventType, filters.eventType));
      if (filters.status) conditions.push(eq(schema.diagnosticEvents.status, filters.status));
      if (filters.severity) conditions.push(eq(schema.diagnosticEvents.severity, filters.severity));
      if (filters.since) conditions.push(gte(schema.diagnosticEvents.occurredAt, filters.since));
      const rows = await database.select().from(schema.diagnosticEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.diagnosticEvents.occurredAt))
        .limit(Math.min(200, Math.max(1, filters.limit ?? 50)));
      return rows.map(toRecord);
    },
  };
}
