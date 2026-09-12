import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type { ProviderCapability } from "../routing/provider-registry";
import type { UserProviderPreferenceRepository } from "./user-provider-preference-repository";

type ProviderDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

export function createDrizzleUserProviderPreferenceRepository<TResult extends PgQueryResultHKT>(
  database: ProviderDatabase<TResult>,
): UserProviderPreferenceRepository {
  return {
    async list(userId) {
      const rows = await database
        .select({
          capability: schema.userProviderPreferences.capability,
          providerKey: schema.userProviderPreferences.providerKey,
        })
        .from(schema.userProviderPreferences)
        .where(eq(schema.userProviderPreferences.userId, userId));
      return rows.map((row) => ({
        capability: row.capability as ProviderCapability,
        providerKey: row.providerKey,
      }));
    },

    async set(userId, capability, providerKey) {
      const [row] = await database
        .insert(schema.userProviderPreferences)
        .values({ userId, capability, providerKey })
        .onConflictDoUpdate({
          target: [
            schema.userProviderPreferences.userId,
            schema.userProviderPreferences.capability,
          ],
          set: { providerKey, updatedAt: new Date() },
        })
        .returning({
          capability: schema.userProviderPreferences.capability,
          providerKey: schema.userProviderPreferences.providerKey,
        });
      if (!row) throw new Error("PROVIDER_PREFERENCE_UNAVAILABLE");
      return { capability: row.capability as ProviderCapability, providerKey: row.providerKey };
    },

    async clear(userId, capability) {
      await database
        .delete(schema.userProviderPreferences)
        .where(and(
          eq(schema.userProviderPreferences.userId, userId),
          eq(schema.userProviderPreferences.capability, capability),
        ));
    },
  };
}
