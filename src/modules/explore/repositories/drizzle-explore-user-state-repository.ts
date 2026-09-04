import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import { explorePackStateKey, type ExploreUserPackState, type ExploreUserState, type ExploreUserStateRepository } from "../domain";

type ExploreDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

export function createDrizzleExploreUserStateRepository<TResult extends PgQueryResultHKT>(
  database: ExploreDatabase<TResult>,
): ExploreUserStateRepository & {
  setPackState(userId: string, pack: { stableKey: string; version: number; totalSteps: number }, patch: { saved?: boolean; completedSteps?: number }): Promise<ExploreUserPackState>;
} {
  return {
    async getForUser(userId) {
      const rows = await database
        .select()
        .from(schema.userContentPackStates)
        .where(eq(schema.userContentPackStates.userId, userId))
        .orderBy(desc(schema.userContentPackStates.lastOpenedAt));
      const packs: Record<string, ExploreUserPackState> = {};
      for (const row of rows) {
        packs[explorePackStateKey(row.packStableKey, row.packVersion)] = {
          saved: row.saved,
          progress: { completedSteps: row.completedSteps, totalSteps: row.totalSteps },
        };
      }
      return { status: "available", packs } satisfies ExploreUserState;
    },

    async setPackState(userId, pack, patch) {
      const completedSteps = Math.max(0, Math.min(pack.totalSteps, patch.completedSteps ?? 0));
      const saved = patch.saved ?? false;
      const now = new Date();
      const [row] = await database
        .insert(schema.userContentPackStates)
        .values({
          userId,
          packStableKey: pack.stableKey,
          packVersion: pack.version,
          saved,
          completedSteps,
          totalSteps: pack.totalSteps,
          lastOpenedAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.userContentPackStates.userId, schema.userContentPackStates.packStableKey, schema.userContentPackStates.packVersion],
          set: { ...(patch.saved === undefined ? {} : { saved }), completedSteps, totalSteps: pack.totalSteps, lastOpenedAt: now, updatedAt: now },
        })
        .returning();
      if (!row) throw new Error("EXPLORE_STATE_WRITE_FAILED");
      return { saved: row.saved, progress: { completedSteps: row.completedSteps, totalSteps: row.totalSteps } };
    },
  };
}
