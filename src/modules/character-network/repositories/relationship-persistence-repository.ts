import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/src/shared/db/schema";

type Database<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;
export type RelationshipPersistenceScope = Readonly<{ userId: string; identityId: string }>;
export type AcceptedEventInput = Readonly<{
  id: string; sequence: number; idempotencyKey: string; eventKind: string; certainty: "explicit" | "supported" | "uncertain"; ruleVersion: string;
  generationId?: string; turnId?: string; characterVersion?: number; episodeKey?: string; payload?: Record<string, unknown>;
  sources: readonly Readonly<{ messageId: string | null; sourceRole: "user" | "character"; position: number }>[];
}>;
export type PendingReceiptInput = Readonly<{ id?: string; receiptKey: string; generationId?: string; turnId?: string; status?: "pending" | "processing" | "failed" | "completed"; attemptCount?: number; nextAttemptAt?: Date | null }>;
export class RelationshipPersistenceError extends Error { constructor(readonly code: "RELATIONSHIP_HEAD_OWNERSHIP" | "RELATIONSHIP_HEAD_REVISION_CONFLICT" | "RELATIONSHIP_EVENT_CONFLICT") { super(code); this.name = "RelationshipPersistenceError"; } }

/**
 * All methods are intended to run inside one outer UoW. When used directly they
 * open their own short transaction. Lock order is relationship_heads first,
 * then events/boundaries/pending sources; conversation/message locks belong to
 * the caller and must be acquired before entering this port.
 */
export function createRelationshipPersistenceRepository<TResult extends PgQueryResultHKT>(database: Database<TResult>, boundExecutor?: Database<TResult>) {
  const run = <T>(work: (tx: Database<TResult>) => Promise<T>) => boundExecutor ? work(boundExecutor) : database.transaction(work);
  const executor = boundExecutor ?? database;
  async function ensureHead(scope: RelationshipPersistenceScope) {
    return run(async (tx) => {
      let [head] = await tx.select().from(schema.relationshipHeads).where(and(eq(schema.relationshipHeads.userId, scope.userId), eq(schema.relationshipHeads.identityId, scope.identityId))).for("update");
      if (!head) {
        [head] = await tx.insert(schema.relationshipHeads).values({ userId: scope.userId, identityId: scope.identityId }).returning();
      }
      if (!head || head.userId !== scope.userId || head.identityId !== scope.identityId) throw new RelationshipPersistenceError("RELATIONSHIP_HEAD_OWNERSHIP");
      return head;
    });
  }
  async function readHead(scope: RelationshipPersistenceScope) {
    const [head] = await executor.select().from(schema.relationshipHeads).where(and(eq(schema.relationshipHeads.userId, scope.userId), eq(schema.relationshipHeads.identityId, scope.identityId)));
    return head ?? null;
  }
  async function compareAndSwapRevision(input: Readonly<{ scope: RelationshipPersistenceScope; headId: string; expected: number; next: number }>) {
    if (!Number.isSafeInteger(input.next) || input.next < 0) throw new RelationshipPersistenceError("RELATIONSHIP_HEAD_REVISION_CONFLICT");
    const rows = await executor.update(schema.relationshipHeads).set({ controlRevision: input.next, updatedAt: new Date() }).where(and(eq(schema.relationshipHeads.id, input.headId), eq(schema.relationshipHeads.userId, input.scope.userId), eq(schema.relationshipHeads.identityId, input.scope.identityId), eq(schema.relationshipHeads.controlRevision, input.expected))).returning();
    if (!rows.length) throw new RelationshipPersistenceError("RELATIONSHIP_HEAD_REVISION_CONFLICT");
    return rows[0]!;
  }
  async function appendAcceptedEvent(scope: RelationshipPersistenceScope, headId: string, event: AcceptedEventInput) {
    return run(async (tx) => {
      const [head] = await tx.select().from(schema.relationshipHeads).where(and(eq(schema.relationshipHeads.id, headId), eq(schema.relationshipHeads.userId, scope.userId), eq(schema.relationshipHeads.identityId, scope.identityId))).for("update");
      if (!head) throw new RelationshipPersistenceError("RELATIONSHIP_HEAD_OWNERSHIP");
      const [existing] = await tx.select().from(schema.relationshipEvents).where(and(eq(schema.relationshipEvents.headId, headId), eq(schema.relationshipEvents.idempotencyKey, event.idempotencyKey)));
      if (existing) {
        if (existing.sequence !== event.sequence || existing.eventKind !== event.eventKind || existing.certainty !== event.certainty || existing.ruleVersion !== event.ruleVersion) throw new RelationshipPersistenceError("RELATIONSHIP_EVENT_CONFLICT");
        return existing;
      }
      if (event.sequence <= head.controlRevision) throw new RelationshipPersistenceError("RELATIONSHIP_EVENT_CONFLICT");
      const [inserted] = await tx.insert(schema.relationshipEvents).values({ id: event.id, headId, userId: scope.userId, identityId: scope.identityId, sequence: event.sequence, idempotencyKey: event.idempotencyKey, eventKind: event.eventKind, certainty: event.certainty, ruleVersion: event.ruleVersion, generationId: event.generationId, turnId: event.turnId, characterVersion: event.characterVersion, episodeKey: event.episodeKey, payload: event.payload ?? {} }).returning();
      if (!inserted) throw new RelationshipPersistenceError("RELATIONSHIP_EVENT_CONFLICT");
      if (event.sources.length) await tx.insert(schema.relationshipEventSources).values(event.sources.map((source) => ({ eventId: inserted.id, messageId: source.messageId, sourceRole: source.sourceRole, position: source.position })));
      await tx.update(schema.relationshipHeads).set({ controlRevision: event.sequence, updatedAt: new Date() }).where(eq(schema.relationshipHeads.id, headId));
      return inserted;
    });
  }
  async function upsertPendingReceipt(scope: RelationshipPersistenceScope, headId: string, input: PendingReceiptInput) {
    return run(async (tx) => {
      const [head] = await tx.select().from(schema.relationshipHeads).where(and(eq(schema.relationshipHeads.id, headId), eq(schema.relationshipHeads.userId, scope.userId), eq(schema.relationshipHeads.identityId, scope.identityId))).for("update");
      if (!head) throw new RelationshipPersistenceError("RELATIONSHIP_HEAD_OWNERSHIP");
      const [existing] = await tx.select().from(schema.relationshipPendingSources).where(and(eq(schema.relationshipPendingSources.headId, headId), eq(schema.relationshipPendingSources.receiptKey, input.receiptKey)));
      if (existing) return existing;
      const [inserted] = await tx.insert(schema.relationshipPendingSources).values({ id: input.id, headId, userId: scope.userId, identityId: scope.identityId, generationId: input.generationId, turnId: input.turnId, receiptKey: input.receiptKey, status: input.status ?? "pending", attemptCount: input.attemptCount ?? 0, nextAttemptAt: input.nextAttemptAt ?? null }).returning();
      return inserted;
    });
  }
  async function rotateEpoch(scope: RelationshipPersistenceScope, headId: string) {
    return run(async (tx) => {
      const [head] = await tx.select().from(schema.relationshipHeads).where(and(eq(schema.relationshipHeads.id, headId), eq(schema.relationshipHeads.userId, scope.userId), eq(schema.relationshipHeads.identityId, scope.identityId))).for("update");
      if (!head) throw new RelationshipPersistenceError("RELATIONSHIP_HEAD_OWNERSHIP");
      await tx.execute(sql`select set_config('app.allow_relationship_event_delete','on',true)`);
      await tx.delete(schema.relationshipHeads).where(eq(schema.relationshipHeads.id, headId));
      const [replacement] = await tx.insert(schema.relationshipHeads).values({ userId: scope.userId, identityId: scope.identityId }).returning();
      return replacement;
    });
  }
  return { ensureHead, readHead, compareAndSwapRevision, appendAcceptedEvent, upsertPendingReceipt, rotateEpoch };
}

/** Build the same port over an already-open transaction; no nested transaction is created. */
export function createRelationshipPersistenceTransaction<TResult extends PgQueryResultHKT>(executor: Database<TResult>) {
  return createRelationshipPersistenceRepository(executor, executor);
}
