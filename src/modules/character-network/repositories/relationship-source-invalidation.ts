import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/src/shared/db/schema";

type Database<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

/**
 * Withdrawn messages must stop contributing relationship evidence immediately.
 * The probe keeps this cleanup compatible with databases deployed before 0056;
 * touching a missing relation inside the caller's transaction would abort it.
 */
export async function tombstoneRelationshipSourcesForMessage<TResult extends PgQueryResultHKT>(
  database: Database<TResult>,
  input: Readonly<{ userMessageId: string; sourceDeletedAt?: Date }>,
): Promise<number> {
  const probe = await database.execute<{ exists: boolean }>(sql`select to_regclass('public.relationship_event_sources') is not null as exists`);
  const probeRows = Array.isArray(probe) ? probe : ((probe as unknown as { rows?: readonly { exists: boolean }[] }).rows ?? []);
  if (!probeRows[0]?.exists) return 0;
  const rows = await database.update(schema.relationshipEventSources)
    .set({ tombstoned: true, sourceDeletedAt: input.sourceDeletedAt ?? new Date() })
    .where(and(eq(schema.relationshipEventSources.messageId, input.userMessageId), eq(schema.relationshipEventSources.tombstoned, false)))
    .returning({ id: schema.relationshipEventSources.id });
  return rows.length;
}

/** Delete relationship state inside the caller's privacy transaction. */
export async function deleteRelationshipHeads<TResult extends PgQueryResultHKT>(
  database: Database<TResult>,
  input: Readonly<{ userId: string; identityId?: string }>,
): Promise<number> {
  const probe = await database.execute<{ exists: boolean }>(sql`select to_regclass('public.relationship_heads') is not null as exists`);
  const probeRows = Array.isArray(probe) ? probe : ((probe as unknown as { rows?: readonly { exists: boolean }[] }).rows ?? []);
  if (!probeRows[0]?.exists) return 0;
  const predicate = input.identityId
    ? and(eq(schema.relationshipHeads.userId, input.userId), eq(schema.relationshipHeads.identityId, input.identityId))
    : eq(schema.relationshipHeads.userId, input.userId);
  const rows = await database.delete(schema.relationshipHeads).where(predicate).returning({ id: schema.relationshipHeads.id });
  return rows.length;
}
