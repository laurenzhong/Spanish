import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/src/shared/db/schema";
import { createRelationshipPersistenceTransaction, type AcceptedEventInput, type RelationshipPersistenceScope } from "../repositories/relationship-persistence-repository";

type Database<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;
export type RelationshipUnitScope = RelationshipPersistenceScope & Readonly<{ epoch: string }>;
export class RelationshipUnitOfWorkError extends Error { constructor(readonly code: "RELATIONSHIP_EPOCH_CONFLICT" | "RELATIONSHIP_REVISION_CONFLICT" | "RELATIONSHIP_HEAD_OWNERSHIP") { super(code); this.name = "RelationshipUnitOfWorkError"; } }
export type RelationshipUnitWork<TResult extends PgQueryResultHKT, T> = (context: Readonly<{ transaction: ReturnType<typeof createRelationshipPersistenceTransaction<TResult>>; head: typeof schema.relationshipHeads.$inferSelect }>) => Promise<T>;

/** Conversation/message locks precede this head lock; this function never opens a nested transaction. */
export async function runRelationshipUnitOfWork<TResult extends PgQueryResultHKT, T>(database: Database<TResult>, scope: RelationshipUnitScope, work: RelationshipUnitWork<TResult, T>, expectedRevision?: number): Promise<T> {
  return database.transaction(async (tx) => {
    const [head] = await tx.select().from(schema.relationshipHeads).where(and(eq(schema.relationshipHeads.userId, scope.userId), eq(schema.relationshipHeads.identityId, scope.identityId))).for("update");
    if (!head || head.epoch !== scope.epoch) throw new RelationshipUnitOfWorkError(head ? "RELATIONSHIP_EPOCH_CONFLICT" : "RELATIONSHIP_HEAD_OWNERSHIP");
    if (expectedRevision !== undefined && head.controlRevision !== expectedRevision) throw new RelationshipUnitOfWorkError("RELATIONSHIP_REVISION_CONFLICT");
    const transaction = createRelationshipPersistenceTransaction(tx as unknown as Database<TResult>);
    return work({ transaction, head });
  });
}

export function commitRelationshipEventInUnitOfWork<TResult extends PgQueryResultHKT>(context: Readonly<{ transaction: ReturnType<typeof createRelationshipPersistenceTransaction<TResult>> }>, scope: RelationshipPersistenceScope, headId: string, event: AcceptedEventInput) {
  return context.transaction.appendAcceptedEvent(scope, headId, event);
}
export function rotateRelationshipEpochInUnitOfWork<TResult extends PgQueryResultHKT>(context: Readonly<{ transaction: ReturnType<typeof createRelationshipPersistenceTransaction<TResult>> }>, scope: RelationshipPersistenceScope, headId: string) {
  return context.transaction.rotateEpoch(scope, headId);
}
