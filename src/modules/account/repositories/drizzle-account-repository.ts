import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type { AccountRepository, AccountProfileRecord, AccountProfileUpdate } from "./account-repository";

type AccountDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

function mapRow(row: typeof schema.profiles.$inferSelect & { targetLanguage: string }): AccountProfileRecord {
  return {
    userId: row.id,
    publicUid: row.publicUid,
    displayName: row.displayName,
    nativeLanguage: row.nativeLanguage,
    interfaceLanguage: row.interfaceLanguage,
    targetLanguage: row.targetLanguage,
    avatarKind: row.avatarKind as AccountProfileRecord["avatarKind"],
    avatarPresetId: row.avatarPresetId as AccountProfileRecord["avatarPresetId"],
    avatarPath: row.avatarPath,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleAccountRepository<TResult extends PgQueryResultHKT>(database: AccountDatabase<TResult>): AccountRepository {
  return {
    async get(userId) {
      const [row] = await database
        .select({
          id: schema.profiles.id,
          publicUid: schema.profiles.publicUid,
          displayName: schema.profiles.displayName,
          nativeLanguage: schema.profiles.nativeLanguage,
          interfaceLanguage: schema.profiles.interfaceLanguage,
          avatarKind: schema.profiles.avatarKind,
          avatarPresetId: schema.profiles.avatarPresetId,
          avatarPath: schema.profiles.avatarPath,
          updatedAt: schema.profiles.updatedAt,
          targetLanguage: schema.userPreferences.preferredSpanishRegion,
        })
        .from(schema.profiles)
        .leftJoin(schema.userPreferences, eq(schema.userPreferences.userId, schema.profiles.id))
        .where(eq(schema.profiles.id, userId))
        .limit(1);
      if (!row) return null;
      return mapRow({ ...row, targetLanguage: row.targetLanguage ?? "es-ES" } as never);
    },

    async update(userId, update: AccountProfileUpdate) {
      const predicates = [eq(schema.profiles.id, userId)];
      if (update.expectedUpdatedAt) predicates.push(eq(schema.profiles.updatedAt, update.expectedUpdatedAt));
      const values = {
        ...(update.displayName === undefined ? {} : { displayName: update.displayName }),
        ...(update.avatarKind === undefined ? {} : { avatarKind: update.avatarKind }),
        ...(update.avatarPresetId === undefined ? {} : { avatarPresetId: update.avatarPresetId }),
        ...(update.avatarPath === undefined ? {} : { avatarPath: update.avatarPath }),
        updatedAt: new Date(),
      };
      const rows = await database.update(schema.profiles).set(values).where(and(...predicates)).returning({ id: schema.profiles.id });
      if (rows.length === 0) {
        return update.expectedUpdatedAt ? "conflict" : null;
      }
      return this.get(userId);
    },
  };
}
