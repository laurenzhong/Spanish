import { and, asc, count, eq, isNull, isNotNull, ne, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";

import type {
  PrivacyRepository,
  AccountDataSummary,
  StorageCleanupTask,
} from "./privacy-repository";

type PrivacyDatabase<TResult extends PgQueryResultHKT> = PgDatabase<
  TResult,
  typeof schema
>;

export function createDrizzlePrivacyRepository<
  TResult extends PgQueryResultHKT,
>(database: PrivacyDatabase<TResult>): PrivacyRepository {
  return {
    async transaction(work) {
      return database.transaction((transaction) =>
        work(createDrizzlePrivacyRepository(transaction)),
      );
    },

    async deleteAccountData(userId) {
      const audio = await database
        .select({
          id: schema.privacyCleanupTasks.id,
          storageBucket: schema.audioAssets.storageBucket,
          storagePath: schema.audioAssets.storagePath,
        })
        .from(schema.audioAssets)
        .leftJoin(
          schema.privacyCleanupTasks,
          and(
            eq(
              schema.privacyCleanupTasks.storageBucket,
              schema.audioAssets.storageBucket,
            ),
            eq(
              schema.privacyCleanupTasks.storagePath,
              schema.audioAssets.storagePath,
            ),
          ),
        )
        .where(eq(schema.audioAssets.userId, userId));

      const cleanupTasks: StorageCleanupTask[] = [];
      for (const asset of audio) {
        const [task] = await database
          .insert(schema.privacyCleanupTasks)
          .values({
            storageBucket: asset.storageBucket,
            storagePath: asset.storagePath,
            status: "pending",
            nextAttemptAt: new Date(),
          })
          .onConflictDoNothing({
            target: [
              schema.privacyCleanupTasks.storageBucket,
              schema.privacyCleanupTasks.storagePath,
            ],
          })
          .returning({
            id: schema.privacyCleanupTasks.id,
            storageBucket: schema.privacyCleanupTasks.storageBucket,
            storagePath: schema.privacyCleanupTasks.storagePath,
          });
        if (task) {
          cleanupTasks.push(task);
        } else {
          const [existing] = await database
            .select({
              id: schema.privacyCleanupTasks.id,
              storageBucket: schema.privacyCleanupTasks.storageBucket,
              storagePath: schema.privacyCleanupTasks.storagePath,
            })
            .from(schema.privacyCleanupTasks)
            .where(
              and(
                eq(
                  schema.privacyCleanupTasks.storageBucket,
                  asset.storageBucket,
                ),
                eq(
                  schema.privacyCleanupTasks.storagePath,
                  asset.storagePath,
                ),
              ),
            )
            .limit(1);
          if (existing) cleanupTasks.push(existing);
        }
      }

      const providerCalls = await database
        .update(schema.providerCalls)
        .set({
          userId: null,
          metadata: { anonymized: true },
          updatedAt: new Date(),
        })
        .where(eq(schema.providerCalls.userId, userId))
        .returning({ id: schema.providerCalls.id });

      const evidence = await database
        .delete(schema.evidenceEvents)
        .where(eq(schema.evidenceEvents.userId, userId))
        .returning({ id: schema.evidenceEvents.id });

      const deletedProfile = await database
        .delete(schema.profiles)
        .where(eq(schema.profiles.id, userId))
        .returning({ id: schema.profiles.id });

      return {
        alreadyDeleted: deletedProfile.length === 0,
        cleanupTasks,
        evidenceDeleted: evidence.length,
        providerCallsAnonymized: providerCalls.length,
      };
    },

    async getAccountDataSummary(userId) {
      const [sessions, attempts, evidence, conversations, memories, audio, transcripts] =
        await Promise.all([
          database
            .select({ count: count() })
            .from(schema.practiceSessions)
            .where(eq(schema.practiceSessions.userId, userId)),
          database
            .select({ count: count() })
            .from(schema.practiceAttempts)
            .where(eq(schema.practiceAttempts.userId, userId)),
          database
            .select({ count: count() })
            .from(schema.evidenceEvents)
            .where(eq(schema.evidenceEvents.userId, userId)),
          database
            .select({ count: count() })
            .from(schema.conversations)
            .where(eq(schema.conversations.userId, userId)),
          database
            .select({ count: count() })
            .from(schema.relationshipMemories)
            .where(eq(schema.relationshipMemories.userId, userId)),
          database
            .select({ count: count() })
            .from(schema.audioAssets)
            .where(
              and(
                eq(schema.audioAssets.userId, userId),
                isNull(schema.audioAssets.deletedAt),
                ne(schema.audioAssets.retentionPolicy, "ephemeral"),
              ),
            ),
          database
            .select({ count: count() })
            .from(schema.practiceAttempts)
            .where(
              and(
                eq(schema.practiceAttempts.userId, userId),
                eq(schema.practiceAttempts.modality, "speech"),
                isNotNull(schema.practiceAttempts.responseText),
              ),
            ),
        ]);
      return {
        sessions: Number(sessions[0]?.count ?? 0),
        practiceAttempts: Number(attempts[0]?.count ?? 0),
        evidenceEvents: Number(evidence[0]?.count ?? 0),
        conversations: Number(conversations[0]?.count ?? 0),
        relationshipMemories: Number(memories[0]?.count ?? 0),
        savedAudio: Number(audio[0]?.count ?? 0),
        savedTranscripts: Number(transcripts[0]?.count ?? 0),
      } satisfies AccountDataSummary;
    },

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

    async updateStorageCleanupTask(taskId, status, errorMessage) {
      const now = new Date();
      const updated = await database
        .update(schema.privacyCleanupTasks)
        .set(
          status === "completed"
            ? {
                status,
                attempts: sql`${schema.privacyCleanupTasks.attempts} + 1`,
                lastError: null,
                completedAt: now,
                nextAttemptAt: null,
                updatedAt: now,
              }
            : {
                status,
                attempts: sql`${schema.privacyCleanupTasks.attempts} + 1`,
                lastError: errorMessage?.slice(0, 240) ?? "Storage cleanup failed.",
                nextAttemptAt: new Date(now.getTime() + 60_000),
                updatedAt: now,
              },
        )
        .where(eq(schema.privacyCleanupTasks.id, taskId))
        .returning({ id: schema.privacyCleanupTasks.id });
      return updated.length > 0;
    },
  };
}
