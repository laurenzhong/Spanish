import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/src/shared/db/schema";
import { advanceVocabularyRecallProgress, VocabularyRecallProgressConflict } from "../domain/vocabulary-recall-progress";
import type { VocabularyRecallProgressRepository } from "./vocabulary-recall-progress-repository";

/** Caller owns the privacy transaction. Rotation rejects old tabs even after profile recreation. */
export async function clearVocabularyRecallWithinTransaction<TResult extends PgQueryResultHKT>(
  database: PgDatabase<TResult, typeof schema>, userId: string,
): Promise<void> {
  await database.insert(schema.userVocabularyRecallSync).values({ userId, epoch: randomUUID() })
    .onConflictDoUpdate({ target: schema.userVocabularyRecallSync.userId, set: { epoch: randomUUID() } });
  await database.delete(schema.userVocabularyRecallProgress).where(eq(schema.userVocabularyRecallProgress.userId, userId));
  await database.delete(schema.userVocabularyRecallReceipts).where(eq(schema.userVocabularyRecallReceipts.userId, userId));
}

export function createDrizzleVocabularyRecallProgressRepository<TResult extends PgQueryResultHKT>(
  database: PgDatabase<TResult, typeof schema>,
): VocabularyRecallProgressRepository {
  const table = schema.userVocabularyRecallProgress;
  const sync = schema.userVocabularyRecallSync;
  const receipts = schema.userVocabularyRecallReceipts;
  type Database = PgDatabase<TResult, typeof schema>;
  async function lock(db: Database, userId: string) {
    await db.insert(sync).values({ userId }).onConflictDoNothing();
    const [state] = await db.select().from(sync).where(eq(sync.userId, userId)).for("update");
    if (!state) throw new Error("VOCABULARY_RECALL_ACCOUNT_UNAVAILABLE");
    return state;
  }
  async function read(db: Database, userId: string, epoch: string) {
    const rows = await db.select().from(table).where(eq(table.userId, userId)).orderBy(asc(table.word), asc(table.mode));
    return { epoch, progress: rows.map(({ word, mode, stage, revision, successfulReviews, nextReviewAt }) => ({
      word, mode, stage, revision, successfulReviews, nextReviewAt: nextReviewAt?.toISOString() ?? null,
    })) };
  }
  return {
    read: (userId) => database.transaction(async (tx) => read(tx, userId, (await lock(tx, userId)).epoch)),
    save: (userId, input, now) => database.transaction(async (tx) => {
      const { epoch } = await lock(tx, userId);
      if (epoch !== input.epoch) throw new VocabularyRecallProgressConflict();
      const payloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const [receipt] = await tx.select().from(receipts).where(and(eq(receipts.userId, userId), eq(receipts.attemptId, input.attemptId)));
      if (receipt) {
        if (receipt.payloadHash !== payloadHash) throw new VocabularyRecallProgressConflict();
        return read(tx, userId, epoch);
      }
      // The account lock serializes absent-row creates, batches, retries and privacy clear.
      for (const entry of input.entries) {
        const [row] = await tx.select().from(table).where(and(eq(table.userId, userId), eq(table.word, entry.word), eq(table.mode, entry.mode)));
        if ((row?.revision ?? 0) !== entry.expectedRevision) throw new VocabularyRecallProgressConflict();
        const current = row ? { ...row, nextReviewAt: row.nextReviewAt?.toISOString() ?? null } : null;
        const next = advanceVocabularyRecallProgress(current, entry, now);
        const values = { ...next, nextReviewAt: next.nextReviewAt ? new Date(next.nextReviewAt) : null, updatedAt: now };
        await tx.insert(table).values({ userId, ...values }).onConflictDoUpdate({
          target: [table.userId, table.word, table.mode], set: values,
        });
      }
      await tx.insert(receipts).values({ userId, attemptId: input.attemptId, payloadHash });
      return read(tx, userId, epoch);
    }),
  };
}
