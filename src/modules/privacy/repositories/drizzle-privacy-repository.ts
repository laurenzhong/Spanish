import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";

import type { PrivacyRepository } from "./privacy-repository";

type PrivacyDatabase<TResult extends PgQueryResultHKT> = PgDatabase<
  TResult,
  typeof schema
>;

export function createDrizzlePrivacyRepository<
  TResult extends PgQueryResultHKT,
>(database: PrivacyDatabase<TResult>): PrivacyRepository {
  return {
    async listSavedAudio(userId) {
      const rows = await database
        .select({
          createdAt: schema.audioAssets.createdAt,
          durationMs: schema.audioAssets.durationMs,
          id: schema.audioAssets.id,
          mimeType: schema.audioAssets.mimeType,
          purpose: schema.audioAssets.purpose,
          retentionPolicy: schema.audioAssets.retentionPolicy,
          sizeBytes: schema.audioAssets.sizeBytes,
        })
        .from(schema.audioAssets)
        .where(
          and(
            eq(schema.audioAssets.userId, userId),
            isNull(schema.audioAssets.deletedAt),
            ne(schema.audioAssets.retentionPolicy, "ephemeral"),
          ),
        )
        .orderBy(asc(schema.audioAssets.createdAt));
      return rows;
    },

    async listTranscripts(userId) {
      const rows = await database
        .select({
          attemptId: schema.practiceAttempts.id,
          createdAt: schema.practiceAttempts.createdAt,
          text: schema.practiceAttempts.responseText,
        })
        .from(schema.practiceAttempts)
        .where(
          and(
            eq(schema.practiceAttempts.userId, userId),
            eq(schema.practiceAttempts.modality, "speech"),
          ),
        )
        .orderBy(asc(schema.practiceAttempts.createdAt));
      return rows.filter(
        (row): row is typeof row & { text: string } =>
          typeof row.text === "string" && row.text.trim().length > 0,
      );
    },

    async deleteSavedAudio(userId, audioAssetId) {
      const deleted = await database
        .update(schema.audioAssets)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.audioAssets.id, audioAssetId),
            eq(schema.audioAssets.userId, userId),
            isNull(schema.audioAssets.deletedAt),
            ne(schema.audioAssets.retentionPolicy, "ephemeral"),
          ),
        )
        .returning({ id: schema.audioAssets.id });
      return deleted.length > 0;
    },

    async deleteTranscript(userId, attemptId) {
      const deleted = await database
        .update(schema.practiceAttempts)
        .set({ responseText: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.practiceAttempts.id, attemptId),
            eq(schema.practiceAttempts.userId, userId),
            eq(schema.practiceAttempts.modality, "speech"),
          ),
        )
        .returning({ id: schema.practiceAttempts.id });
      return deleted.length > 0;
    },
  };
}
