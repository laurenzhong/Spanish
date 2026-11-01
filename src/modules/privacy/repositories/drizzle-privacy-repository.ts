import { and, asc, count, desc, eq, inArray, isNull, isNotNull, ne, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import { clearVocabularyMarksWithinTransaction } from "@/src/modules/lexicon-corpus/repositories/drizzle-vocabulary-marks-repository";
import { clearVocabularyRecallWithinTransaction } from "@/src/modules/lexicon-corpus/repositories/drizzle-vocabulary-recall-progress-repository";
import { deleteRelationshipHeads } from "@/src/modules/character-network/repositories/relationship-source-invalidation";
import { toPersistedRelationshipExportDto } from "@/src/modules/character-network/application/relationship-privacy";

import type {
  AccountBusinessDataDeletionResult,
  AccountExportCollection,
  AccountExportLimits,
  AccountExportSnapshot,
  PrivacyRepository,
  AccountDataSummary,
  CharacterDataDeletionResult,
  StorageCleanupTask,
} from "./privacy-repository";

type PrivacyDatabase<TResult extends PgQueryResultHKT> = PgDatabase<
  TResult,
  typeof schema
>;

function collection<T>(
  rows: readonly T[],
  limit: number,
): AccountExportCollection<T> {
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

export function createDrizzlePrivacyRepository<
  TResult extends PgQueryResultHKT,
>(database: PrivacyDatabase<TResult>): PrivacyRepository {
  async function clearBusinessData(
    userId: string,
  ): Promise<AccountBusinessDataDeletionResult> {
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

    // Driver-agnostic profile lookup: PGlite's drizzle `execute` returns
    // `{ rows }` while postgres-js returns an array-like. The information_schema
    // probe only guards against old migration subsets that lack the 0015 columns;
    // profile existence itself is always read from `profiles`.
    const [profileRow] = await database
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, userId))
      .limit(1);
    const profileExists = profileRow !== undefined;
    let profile: { publicUid: string; avatarPath: string | null } | undefined;
    const rawAccountColumns = await database.execute<{ column_name: string }>(sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles'
        and column_name in ('public_uid', 'avatar_path')
    `);
    const accountColumns = Array.isArray(rawAccountColumns)
      ? (rawAccountColumns as readonly unknown[])
      : ((rawAccountColumns as unknown as { rows?: readonly unknown[] }).rows ?? []);
    if (profileExists && accountColumns.length === 2) {
      [profile] = await database
        .select({ publicUid: schema.profiles.publicUid, avatarPath: schema.profiles.avatarPath })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, userId))
        .limit(1);
    }
    if (profile) {
      await database
        .insert(schema.reservedPublicUids)
        .values({ publicUid: profile.publicUid, reason: "account-deleted" })
        .onConflictDoNothing({ target: schema.reservedPublicUids.publicUid });
      if (profile.avatarPath) {
        const [task] = await database
          .insert(schema.privacyCleanupTasks)
          .values({ storageBucket: "profile-avatars", storagePath: profile.avatarPath, status: "pending", nextAttemptAt: new Date() })
          .onConflictDoNothing({ target: [schema.privacyCleanupTasks.storageBucket, schema.privacyCleanupTasks.storagePath] })
          .returning({ id: schema.privacyCleanupTasks.id, storageBucket: schema.privacyCleanupTasks.storageBucket, storagePath: schema.privacyCleanupTasks.storagePath });
        if (task) cleanupTasks.push(task);
      }
    }

    const evidence = await database
      .delete(schema.evidenceEvents)
      .where(eq(schema.evidenceEvents.userId, userId))
      .returning({ id: schema.evidenceEvents.id });

    // Relationship heads own their events, boundaries and pending receipts;
    // clear them in this same account transaction while retaining the profile
    // tombstone for retryable account deletion.
    await deleteRelationshipHeads(database, { userId });

    // Learning observations are private, append-only facts and must be removed
    // in the same business-data transaction as evidence and conversations.
    await database
      .delete(schema.learningObservationEvents)
      .where(eq(schema.learningObservationEvents.userId, userId));
    await database
      .delete(schema.learningInsightFeedback)
      .where(eq(schema.learningInsightFeedback.userId, userId));
    await database
      .delete(schema.learningInsightReports)
      .where(eq(schema.learningInsightReports.userId, userId));
    if (profileExists) await clearVocabularyMarksWithinTransaction(database, userId);
    if (profileExists) await clearVocabularyRecallWithinTransaction(database, userId);

    return {
      alreadyDeleted: !profileExists,
      cleanupTasks,
      evidenceDeleted: evidence.length,
      providerCallsAnonymized: providerCalls.length,
    };
  }

  async function deleteProfileRow(userId: string): Promise<boolean> {
    const deleted = await database
      .delete(schema.profiles)
      .where(eq(schema.profiles.id, userId))
      .returning({ id: schema.profiles.id });
    return deleted.length > 0;
  }

  async function readAccountExport(
    userId: string,
    limits: AccountExportLimits,
  ): Promise<AccountExportSnapshot> {
    const [accountRow] = await database
      .select({
        publicUid: schema.profiles.publicUid,
        displayName: schema.profiles.displayName,
        role: schema.profiles.role,
        accountStatus: schema.profiles.accountStatus,
        avatarKind: schema.profiles.avatarKind,
        createdAt: schema.profiles.createdAt,
      })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, userId))
      .limit(1);

    const [preferenceRow] = await database
      .select({
        preferredSpanishRegion: schema.userPreferences.preferredSpanishRegion,
        correctionMode: schema.userPreferences.correctionMode,
        voiceInputPreferred: schema.userPreferences.voiceInputPreferred,
        learningInsightsEnabled: schema.userPreferences.learningInsightsEnabled,
        recordAssistantLearningIntent: schema.userPreferences.recordAssistantLearningIntent,
      })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .limit(1);

    const practiceSessions = collection(
      await database
        .select({
          id: schema.practiceSessions.id,
          status: schema.practiceSessions.status,
          primaryModality: schema.practiceSessions.primaryModality,
          contentVersion: schema.practiceSessions.contentVersion,
          startedAt: schema.practiceSessions.startedAt,
          completedAt: schema.practiceSessions.completedAt,
        })
        .from(schema.practiceSessions)
        .where(eq(schema.practiceSessions.userId, userId))
        .orderBy(asc(schema.practiceSessions.startedAt), asc(schema.practiceSessions.id))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const practiceAttempts = collection(
      await database
        .select({
          id: schema.practiceAttempts.id,
          sessionId: schema.practiceAttempts.sessionId,
          modality: schema.practiceAttempts.modality,
          responseText: schema.practiceAttempts.responseText,
          hintLevel: schema.practiceAttempts.hintLevel,
          transcriptConfidence: schema.practiceAttempts.transcriptConfidence,
          contentVersion: schema.practiceAttempts.contentVersion,
          algorithmVersion: schema.practiceAttempts.algorithmVersion,
          createdAt: schema.practiceAttempts.createdAt,
        })
        .from(schema.practiceAttempts)
        .where(eq(schema.practiceAttempts.userId, userId))
        .orderBy(asc(schema.practiceAttempts.createdAt), asc(schema.practiceAttempts.id))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const evidenceEvents = collection(
      await database
        .select({
          id: schema.evidenceEvents.id,
          practiceAttemptId: schema.evidenceEvents.practiceAttemptId,
          skillKey: schema.evidenceEvents.skillKey,
          modality: schema.evidenceEvents.modality,
          outcomeScore: schema.evidenceEvents.outcomeScore,
          evidenceWeight: schema.evidenceEvents.evidenceWeight,
          confidence: schema.evidenceEvents.confidence,
          contentVersion: schema.evidenceEvents.contentVersion,
          algorithmVersion: schema.evidenceEvents.algorithmVersion,
          occurredAt: schema.evidenceEvents.occurredAt,
        })
        .from(schema.evidenceEvents)
        .where(eq(schema.evidenceEvents.userId, userId))
        .orderBy(asc(schema.evidenceEvents.occurredAt), asc(schema.evidenceEvents.id))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const skillStates = collection(
      await database
        .select({
          skillKey: schema.userSkillStates.skillKey,
          mastery: schema.userSkillStates.mastery,
          confidence: schema.userSkillStates.confidence,
          evidenceCount: schema.userSkillStates.evidenceCount,
          lastEvidenceAt: schema.userSkillStates.lastEvidenceAt,
          snapshotVersion: schema.userSkillStates.snapshotVersion,
        })
        .from(schema.userSkillStates)
        .where(eq(schema.userSkillStates.userId, userId))
        .orderBy(asc(schema.userSkillStates.skillKey))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const learningBreakpoints = collection(
      await database
        .select({
          sessionId: schema.learningBreakpoints.sessionId,
          state: schema.learningBreakpoints.state,
          generation: schema.learningBreakpoints.generation,
          expiresAt: schema.learningBreakpoints.expiresAt,
          updatedAt: schema.learningBreakpoints.updatedAt,
        })
        .from(schema.learningBreakpoints)
        .where(eq(schema.learningBreakpoints.userId, userId))
        .orderBy(asc(schema.learningBreakpoints.updatedAt))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const sceneStates = collection(
      await database
        .select({
          scenarioId: schema.userSceneStates.scenarioId,
          status: schema.userSceneStates.status,
          mastery: schema.userSceneStates.mastery,
          confidence: schema.userSceneStates.confidence,
          oralCoverage: schema.userSceneStates.oralCoverage,
          evidenceCount: schema.userSceneStates.evidenceCount,
          lastVerifiedAt: schema.userSceneStates.lastVerifiedAt,
          snapshotVersion: schema.userSceneStates.snapshotVersion,
        })
        .from(schema.userSceneStates)
        .where(eq(schema.userSceneStates.userId, userId))
        .orderBy(asc(schema.userSceneStates.scenarioId))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const readingProgress = collection(
      await database
        .select({
          articleVersionId: schema.userReadingProgress.articleVersionId,
          contentHash: schema.userReadingProgress.contentHash,
          position: schema.userReadingProgress.position,
          status: schema.userReadingProgress.status,
          note: schema.userReadingProgress.note,
          lastOpenedAt: schema.userReadingProgress.lastOpenedAt,
        })
        .from(schema.userReadingProgress)
        .where(eq(schema.userReadingProgress.userId, userId))
        .orderBy(asc(schema.userReadingProgress.lastOpenedAt))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const articleSaves = collection(
      await database
        .select({
          articleVersionId: schema.userArticleSaves.articleVersionId,
          createdAt: schema.userArticleSaves.createdAt,
        })
        .from(schema.userArticleSaves)
        .where(eq(schema.userArticleSaves.userId, userId))
        .orderBy(asc(schema.userArticleSaves.createdAt))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const articleHighlights = collection(
      await database
        .select({
          articleVersionId: schema.userArticleHighlights.articleVersionId,
          itemType: schema.userArticleHighlights.itemType,
          segmentPosition: schema.userArticleHighlights.segmentPosition,
          text: schema.userArticleHighlights.text,
          createdAt: schema.userArticleHighlights.createdAt,
        })
        .from(schema.userArticleHighlights)
        .where(eq(schema.userArticleHighlights.userId, userId))
        .orderBy(asc(schema.userArticleHighlights.createdAt))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const savedSources = collection(
      await database
        .select({
          sourceUrl: schema.userSavedArticleSources.sourceUrl,
          normalizedUrl: schema.userSavedArticleSources.normalizedUrl,
          title: schema.userSavedArticleSources.title,
          author: schema.userSavedArticleSources.author,
          sourceName: schema.userSavedArticleSources.sourceName,
          license: schema.userSavedArticleSources.license,
          copyrightStatus: schema.userSavedArticleSources.copyrightStatus,
          status: schema.userSavedArticleSources.status,
          createdAt: schema.userSavedArticleSources.createdAt,
        })
        .from(schema.userSavedArticleSources)
        .where(eq(schema.userSavedArticleSources.userId, userId))
        .orderBy(asc(schema.userSavedArticleSources.createdAt))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const mediaProgress = collection(
      await database
        .select({
          mediaVersionId: schema.userMediaProgress.mediaVersionId,
          lastPositionMs: schema.userMediaProgress.lastPositionMs,
          lastSegmentIndex: schema.userMediaProgress.lastSegmentIndex,
          status: schema.userMediaProgress.status,
          lastOpenedAt: schema.userMediaProgress.lastOpenedAt,
        })
        .from(schema.userMediaProgress)
        .where(eq(schema.userMediaProgress.userId, userId))
        .orderBy(asc(schema.userMediaProgress.lastOpenedAt))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const vocabularyMarks = collection(
      await database.select({ word: schema.userVocabularyMarks.word, status: schema.userVocabularyMarks.status, updatedAt: schema.userVocabularyMarks.updatedAt })
        .from(schema.userVocabularyMarks).where(eq(schema.userVocabularyMarks.userId, userId))
        .orderBy(asc(schema.userVocabularyMarks.word)).limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const vocabularyRecallProgress = collection(
      await database.select({
        word: schema.userVocabularyRecallProgress.word, mode: schema.userVocabularyRecallProgress.mode,
        stage: schema.userVocabularyRecallProgress.stage, revision: schema.userVocabularyRecallProgress.revision,
        successfulReviews: schema.userVocabularyRecallProgress.successfulReviews,
        nextReviewAt: schema.userVocabularyRecallProgress.nextReviewAt, updatedAt: schema.userVocabularyRecallProgress.updatedAt,
      }).from(schema.userVocabularyRecallProgress).where(eq(schema.userVocabularyRecallProgress.userId, userId))
        .orderBy(asc(schema.userVocabularyRecallProgress.word), asc(schema.userVocabularyRecallProgress.mode)).limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const savedExpressions = collection(
      await database
        .select({
          sourceText: schema.userSavedExpressions.sourceText,
          translation: schema.userSavedExpressions.translation,
          register: schema.userSavedExpressions.register,
          usageNotes: schema.userSavedExpressions.usageNotes,
          sourceType: schema.userSavedExpressions.sourceType,
          archived: schema.userSavedExpressions.archived,
          createdAt: schema.userSavedExpressions.createdAt,
        })
        .from(schema.userSavedExpressions)
        .where(eq(schema.userSavedExpressions.userId, userId))
        .orderBy(asc(schema.userSavedExpressions.createdAt))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const learningObservations = collection(
      await database
        .select({
          eventType: schema.learningObservationEvents.eventType,
          sourceModule: schema.learningObservationEvents.sourceModule,
          subjectType: schema.learningObservationEvents.subjectType,
          subjectId: schema.learningObservationEvents.subjectId,
          subjectVersion: schema.learningObservationEvents.subjectVersion,
          signalStrength: schema.learningObservationEvents.signalStrength,
          metadata: schema.learningObservationEvents.metadata,
          occurredAt: schema.learningObservationEvents.occurredAt,
          dedupeKey: schema.learningObservationEvents.dedupeKey,
          algorithmVersion: schema.learningObservationEvents.algorithmVersion,
        })
        .from(schema.learningObservationEvents)
        .where(eq(schema.learningObservationEvents.userId, userId))
        .orderBy(asc(schema.learningObservationEvents.occurredAt))
        .limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const learningInsightReports = collection(
      await database.select({
        localDate: schema.learningInsightReports.localDate,
        timezone: schema.learningInsightReports.timezone,
        reportVersion: schema.learningInsightReports.reportVersion,
        status: schema.learningInsightReports.status,
        coverage: schema.learningInsightReports.coverage,
        summary: schema.learningInsightReports.summary,
        candidates: schema.learningInsightReports.candidates,
        sourceEventIds: schema.learningInsightReports.sourceEventIds,
        algorithmVersion: schema.learningInsightReports.algorithmVersion,
      }).from(schema.learningInsightReports).where(eq(schema.learningInsightReports.userId, userId)).orderBy(asc(schema.learningInsightReports.localDate)).limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const learningInsightFeedback = collection(
      await database.select({
        reportId: schema.learningInsightFeedback.reportId,
        candidateKey: schema.learningInsightFeedback.candidateKey,
        feedback: schema.learningInsightFeedback.feedback,
        dedupeKey: schema.learningInsightFeedback.dedupeKey,
        createdAt: schema.learningInsightFeedback.createdAt,
      }).from(schema.learningInsightFeedback).where(eq(schema.learningInsightFeedback.userId, userId)).orderBy(asc(schema.learningInsightFeedback.createdAt)).limit(limits.perCategory + 1),
      limits.perCategory,
    );

    const conversations = collection(
      await database
        .select({
          id: schema.conversations.id,
          characterKey: schema.characters.stableKey,
          createdAt: schema.conversations.createdAt,
        })
        .from(schema.conversations)
        .innerJoin(
          schema.characters,
          eq(schema.characters.id, schema.conversations.characterId),
        )
        .where(eq(schema.conversations.userId, userId))
        .orderBy(asc(schema.conversations.createdAt), asc(schema.conversations.id))
        .limit(limits.conversations + 1),
      limits.conversations,
    );

    const conversationIds = conversations.rows.map((row) => row.id);
    const messages = collection(
      conversationIds.length === 0
        ? []
        : await database
            .select({
              conversationId: schema.messages.conversationId,
              role: schema.messages.role,
              status: schema.messages.status,
              content: schema.messages.content,
              createdAt: schema.messages.createdAt,
            })
            .from(schema.messages)
            .where(
              and(
                eq(schema.messages.userId, userId),
                inArray(schema.messages.conversationId, conversationIds),
              ),
            )
            .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))
            .limit(limits.messages + 1),
      limits.messages,
    );

    // Relationship state is optional while migration 0056 rolls out. The
    // catalog probe must happen before any typed table query so older export
    // databases continue to produce the legacy snapshot safely.
    let relationships: AccountExportSnapshot["relationships"];
    const relationshipProbe = await database.execute<{ exists: boolean }>(sql`select to_regclass('public.relationship_heads') is not null as exists`);
    const relationshipProbeRows = Array.isArray(relationshipProbe) ? relationshipProbe : ((relationshipProbe as unknown as { rows?: readonly { exists: boolean }[] }).rows ?? []);
    if (relationshipProbeRows[0]?.exists) {
      const [head] = await database.select({
        id: schema.relationshipHeads.id,
        ruleVersion: schema.relationshipEvents.ruleVersion,
        identityId: schema.relationshipHeads.identityId,
        characterKey: schema.characterIdentities.stableKey,
        boundaryRevision: schema.relationshipHeads.controlRevision,
      }).from(schema.relationshipHeads)
        .innerJoin(schema.characterIdentities, eq(schema.characterIdentities.id, schema.relationshipHeads.identityId))
        .leftJoin(schema.relationshipEvents, eq(schema.relationshipEvents.headId, schema.relationshipHeads.id))
        .where(eq(schema.relationshipHeads.userId, userId))
        .orderBy(desc(schema.relationshipEvents.sequence))
        .limit(1);
      if (head) {
        const eventRows = await database.select({
          id: schema.relationshipEvents.id,
          kind: schema.relationshipEvents.eventKind,
          certainty: schema.relationshipEvents.certainty,
          sequence: schema.relationshipEvents.sequence,
          turnId: schema.relationshipEvents.turnId,
          episodeKey: schema.relationshipEvents.episodeKey,
          payload: schema.relationshipEvents.payload,
        }).from(schema.relationshipEvents).where(eq(schema.relationshipEvents.headId, head.id)).orderBy(asc(schema.relationshipEvents.sequence)).limit(limits.perCategory + 1);
        const eventIds = eventRows.map((event) => event.id);
        const sourceRows = eventIds.length ? await database.select({ eventId: schema.relationshipEventSources.eventId, messageId: schema.relationshipEventSources.messageId, tombstoned: schema.relationshipEventSources.tombstoned, sourceDeletedAt: schema.relationshipEventSources.sourceDeletedAt }).from(schema.relationshipEventSources).where(inArray(schema.relationshipEventSources.eventId, eventIds)) : [];
        const sourceIds = [...new Set(sourceRows.map((source) => source.messageId).filter((id): id is string => !!id))];
        const sourceMessages = sourceIds.length ? await database.select({ id: schema.messages.id, status: schema.messages.status }).from(schema.messages).where(inArray(schema.messages.id, sourceIds)) : [];
        const liveSource = (source: typeof sourceRows[number]) => !!source.messageId && !source.tombstoned && !source.sourceDeletedAt && sourceMessages.find((message) => message.id === source.messageId)?.status === "completed";
        const payloadValue = (payload: unknown, key: string): string | null => {
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
          const value = (payload as Record<string, unknown>)[key];
          return typeof value === "string" && value.length <= 160 ? value : null;
        };
        const boundaries = await database.select({ scope: schema.relationshipBoundaries.scope, target: schema.relationshipBoundaries.target, status: schema.relationshipBoundaries.status }).from(schema.relationshipBoundaries).where(eq(schema.relationshipBoundaries.headId, head.id)).orderBy(asc(schema.relationshipBoundaries.revision), asc(schema.relationshipBoundaries.id));
        relationships = toPersistedRelationshipExportDto({
          characterKey: head.characterKey,
          ruleVersion: head.ruleVersion ?? "relationship-v1",
          boundaryRevision: head.boundaryRevision,
          boundaries,
          events: eventRows.map((event) => ({
            kind: event.kind,
            certainty: event.certainty,
            sequence: event.sequence,
            turnId: event.turnId,
            episodeId: event.episodeKey ?? payloadValue(event.payload, "episodeId"),
            sessionId: payloadValue(event.payload, "sessionId"),
            sourceMessageIds: sourceRows.filter((source) => source.eventId === event.id && liveSource(source)).map((source) => source.messageId!).slice(0, limits.perCategory),
          })),
          limit: limits.perCategory,
        });
      }
    }

    return {
      account: accountRow ?? null,
      preferences: preferenceRow ?? null,
      practiceSessions,
      practiceAttempts,
      evidenceEvents,
      skillStates,
      learningBreakpoints,
      sceneStates,
      readingProgress,
      articleSaves,
      articleHighlights,
      savedSources,
      mediaProgress,
      savedExpressions,
      vocabularyMarks,
      vocabularyRecallProgress,
      learningObservations,
      learningInsightReports,
      learningInsightFeedback,
      conversations,
      messages,
      ...(relationships ? { relationships } : {}),
    };
  }

  return {
    async transaction(work) {
      return database.transaction((transaction) =>
        work(createDrizzlePrivacyRepository(transaction)),
      );
    },

    async deleteAccountData(userId) {
      const cleared = await clearBusinessData(userId);
      const removed = await deleteProfileRow(userId);
      return {
        ...cleared,
        // Legacy one-shot semantics: `alreadyDeleted` reports whether there was
        // a profile row left to delete.
        alreadyDeleted: !removed,
      };
    },

    async clearAccountBusinessData(userId) {
      return clearBusinessData(userId);
    },

    async deleteAccountProfile(userId) {
      return deleteProfileRow(userId);
    },

    async deleteCharacterData(userId, characterKey) {
      // One identity, every revision. All of this user's state for the stable
      // key hangs off `identity_id`, so the deletion no longer tries to guess
      // which revision rows were written under: the 2026-10-12 v1 -> v2
      // rollover moved the conversation to a new revision row while the
      // relationship stayed on the old one, and resolving revisions by
      // `character_id` could only catch one of the two.
      const [identity] = await database
        .select({ id: schema.characterIdentities.id })
        .from(schema.characterIdentities)
        .where(eq(schema.characterIdentities.stableKey, characterKey))
        .limit(1);
      if (!identity) throw new Error("CHARACTER_UNAVAILABLE");

      const conversationRows = await database
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(and(
          eq(schema.conversations.userId, userId),
          eq(schema.conversations.identityId, identity.id),
        ));
      const conversationIds = conversationRows.map((row) => row.id);

      // A fresh contact must not inherit old mute/read state or introduction
      // offers whose reason/context was derived from the previous relationship.
      await database.delete(schema.conversationPreferences).where(and(
        eq(schema.conversationPreferences.userId, userId),
        eq(schema.conversationPreferences.identityId, identity.id),
      ));
      await database.delete(schema.characterIntroductionOffers).where(and(
        eq(schema.characterIntroductionOffers.userId, userId),
        or(
          eq(schema.characterIntroductionOffers.sourceIdentityId, identity.id),
          eq(schema.characterIntroductionOffers.targetIdentityId, identity.id),
        ),
      ));

      // Resetting a relationship must revoke inbound sharing grants to Lucía;
      // the source memories themselves remain untouched when they belong to
      // another character.
      const permissions = await database
        .delete(schema.memorySharingPermissions)
        .where(and(
          eq(schema.memorySharingPermissions.userId, userId),
          eq(schema.memorySharingPermissions.targetIdentityId, identity.id),
        ))
        .returning({ id: schema.memorySharingPermissions.id });

      const memories = await database
        .delete(schema.relationshipMemories)
        .where(and(
          eq(schema.relationshipMemories.userId, userId),
          eq(schema.relationshipMemories.identityId, identity.id),
        ))
        .returning({ id: schema.relationshipMemories.id });

      await deleteRelationshipHeads(database, { userId, identityId: identity.id });

      let messages: { id: string }[] = [];
      if (conversationIds.length > 0) {
        messages = await database
          .delete(schema.messages)
          .where(and(
            eq(schema.messages.userId, userId),
            inArray(schema.messages.conversationId, conversationIds),
          ))
          .returning({ id: schema.messages.id });
      }

      const relationships = await database
        .delete(schema.characterRelationships)
        .where(and(
          eq(schema.characterRelationships.userId, userId),
          eq(schema.characterRelationships.identityId, identity.id),
        ))
        .returning({ id: schema.characterRelationships.id });

      const conversations = await database
        .delete(schema.conversations)
        .where(and(
          eq(schema.conversations.userId, userId),
          eq(schema.conversations.identityId, identity.id),
        ))
        .returning({ id: schema.conversations.id });

      return {
        characterKey,
        conversationsDeleted: conversations.length,
        messagesDeleted: messages.length,
        relationshipMemoriesDeleted: memories.length,
        memoryPermissionsRevoked: permissions.length,
        relationshipSnapshotsDeleted: relationships.length,
      } satisfies CharacterDataDeletionResult;
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

    async readAccountExport(userId, limits) {
      return readAccountExport(userId, limits);
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
