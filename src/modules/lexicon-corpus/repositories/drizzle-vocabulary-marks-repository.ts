import { eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/src/shared/db/schema";
import type { VocabularyMarksRepository } from "./vocabulary-marks-repository";
import type { VocabularyMarks } from "../schemas/vocabulary-marks";

/** Caller owns the transaction, so the privacy clear and its import barrier commit together. */
export async function clearVocabularyMarksWithinTransaction<TResult extends PgQueryResultHKT>(
  database: PgDatabase<TResult, typeof schema>, userId: string,
): Promise<void> {
  await database.insert(schema.userVocabularyMarkSyncState).values({ userId, legacyImportBlocked: true })
    .onConflictDoUpdate({ target: schema.userVocabularyMarkSyncState.userId, set: { legacyImportBlocked: true } });
  await database.delete(schema.userVocabularyMarks).where(eq(schema.userVocabularyMarks.userId, userId));
}

export function createDrizzleVocabularyMarksRepository<TResult extends PgQueryResultHKT>(
  database: PgDatabase<TResult, typeof schema>,
): VocabularyMarksRepository {
  const table = schema.userVocabularyMarks;
  async function read(db: PgDatabase<TResult, typeof schema>, userId: string): Promise<VocabularyMarks> {
    const rows = await db.select({ word: table.word, status: table.status }).from(table).where(eq(table.userId, userId));
    return Object.fromEntries(rows.map((row) => [row.word, row.status]));
  }
  return {
    read: (userId) => read(database, userId),
    set: (userId, word, status) => database.transaction(async (tx) => {
      await tx.insert(table).values({ userId, word, status }).onConflictDoUpdate({
        target: [table.userId, table.word],
        set: { status, updatedAt: sql`now()` },
      });
      return read(tx, userId);
    }),
    importMissing: (userId, marks) => database.transaction(async (tx) => {
      const sync = schema.userVocabularyMarkSyncState;
      await tx.insert(sync).values({ userId }).onConflictDoNothing();
      const [state] = await tx.select().from(sync).where(eq(sync.userId, userId)).for("update");
      if (state.legacyImportBlocked) return read(tx, userId);
      const rows = Object.entries(marks).map(([word, status]) => ({ userId, word, status }));
      for (let offset = 0; offset < rows.length; offset += 500) {
        await tx.insert(table).values(rows.slice(offset, offset + 500))
          .onConflictDoNothing({ target: [table.userId, table.word] });
      }
      return read(tx, userId);
    }),
  };
}
