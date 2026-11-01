import type {
  AccountExportCollection,
  AccountExportLimits,
  AccountExportSnapshot,
  PrivacyRepository,
} from "../repositories";

/**
 * Personal data export (ACCT-ADMIN-001, design §5.3).
 *
 * Produces a versioned JSON document for the *authenticated user only*. It never
 * contains audio/video binaries, Storage paths, signed URLs, internal Auth ids,
 * other users' data, private relationship memories, provider calls or
 * credentials. Oversized collections are capped and reported through
 * `truncated` instead of being silently dropped.
 */
export const ACCOUNT_EXPORT_VERSION = "1" as const;

export const ACCOUNT_EXPORT_LIMITS: AccountExportLimits = {
  perCategory: 2_000,
  conversations: 200,
  messages: 5_000,
};

export type AccountExportDto = Readonly<{
  exportVersion: typeof ACCOUNT_EXPORT_VERSION;
  generatedAt: string;
  account: Readonly<{
    publicUid: string;
    displayName: string | null;
    role: "owner" | "member";
    accountStatus: "active" | "suspended";
    createdAt: string;
    avatarKind: string;
  }>;
  preferences: Readonly<{
    preferredSpanishRegion: string;
    correctionMode: string;
    voiceInputPreferred: string;
    learningInsightsEnabled: boolean;
    recordAssistantLearningIntent: boolean;
  }> | null;
  learning: Readonly<{
    practiceSessions: readonly Record<string, unknown>[];
    practiceAttempts: readonly Record<string, unknown>[];
    evidenceEvents: readonly Record<string, unknown>[];
    skillStates: readonly Record<string, unknown>[];
    learningBreakpoints: readonly Record<string, unknown>[];
    sceneStates: readonly Record<string, unknown>[];
    observations: readonly Record<string, unknown>[];
    insightReports: readonly Record<string, unknown>[];
    insightFeedback: readonly Record<string, unknown>[];
  }>;
  reading: Readonly<{
    progress: readonly Record<string, unknown>[];
    saves: readonly Record<string, unknown>[];
    highlights: readonly Record<string, unknown>[];
    savedSources: readonly Record<string, unknown>[];
  }>;
  media: Readonly<{ progress: readonly Record<string, unknown>[] }>;
  relationships?: Readonly<{
    schemaVersion: 1;
    characterKey: string;
    ruleVersion: string;
    familiarity: string;
    userRomanticIntent: string;
    characterProposal: string;
    interactionSafety: string;
    boundaryRevision: number;
    boundaries: readonly Record<string, unknown>[];
    evidence: readonly Record<string, unknown>[];
    truncated: boolean;
  }>;
  savedExpressions: readonly Record<string, unknown>[];
  vocabularyMarks: readonly Readonly<{ word: string; status: string | null; updatedAt: string }>[];
  vocabularyRecallProgress: readonly Readonly<{ word: string; mode: string; stage: string; revision: number; successfulReviews: number; nextReviewAt: string | null; updatedAt: string }>[];
  conversations: readonly Readonly<{
    characterKey: string;
    createdAt: string;
    messages: readonly Readonly<{
      role: string;
      status: string;
      content: string;
      createdAt: string;
    }>[];
  }>[];
  truncated: Readonly<{
    conversations: boolean;
    messages: boolean;
    /** Names of the ordinary collections that hit the per-category cap. */
    categories: readonly string[];
  }>;
}>;

export type ExportAccountDataOptions = Readonly<{
  limits?: AccountExportLimits;
  now?: Date;
}>;

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function truncatedCategories(snapshot: AccountExportSnapshot): readonly string[] {
  const collections: ReadonlyArray<readonly [string, AccountExportCollection<unknown>]> = [
    ["practiceSessions", snapshot.practiceSessions],
    ["practiceAttempts", snapshot.practiceAttempts],
    ["evidenceEvents", snapshot.evidenceEvents],
    ["skillStates", snapshot.skillStates],
    ["learningBreakpoints", snapshot.learningBreakpoints],
    ["sceneStates", snapshot.sceneStates],
    ["learningObservations", snapshot.learningObservations],
    ["learningInsightReports", snapshot.learningInsightReports],
    ["learningInsightFeedback", snapshot.learningInsightFeedback],
    ["readingProgress", snapshot.readingProgress],
    ["articleSaves", snapshot.articleSaves],
    ["articleHighlights", snapshot.articleHighlights],
    ["savedSources", snapshot.savedSources],
    ["mediaProgress", snapshot.mediaProgress],
    ["savedExpressions", snapshot.savedExpressions],
    ["vocabularyMarks", snapshot.vocabularyMarks],
    ["vocabularyRecallProgress", snapshot.vocabularyRecallProgress],
  ];
  return collections.filter(([, collection]) => collection.truncated).map(([label]) => label);
}


function mapRows<T>(
  collection: AccountExportCollection<T>,
  mapRow: (row: T) => Record<string, unknown>,
): readonly Record<string, unknown>[] {
  return collection.rows.map(mapRow);
}

/**
 * Build the export document. Fails when the account profile is already gone so
 * the Route Handler can return a retryable `EXPORT_UNAVAILABLE` instead of a
 * half-filled export.
 */
export async function exportAccountData(
  repository: PrivacyRepository,
  userId: string,
  options: ExportAccountDataOptions = {},
): Promise<AccountExportDto> {
  const limits = options.limits ?? ACCOUNT_EXPORT_LIMITS;
  const snapshot = await repository.readAccountExport(userId, limits);
  if (!snapshot.account) throw new Error("account-export-profile-missing");

  const messagesByConversation = new Map<
    string,
    Array<{ role: string; status: string; content: string; createdAt: string }>
  >();
  for (const message of snapshot.messages.rows) {
    const list = messagesByConversation.get(message.conversationId) ?? [];
    list.push({
      role: message.role,
      status: message.status,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    });
    messagesByConversation.set(message.conversationId, list);
  }

  const truncated = truncatedCategories(snapshot);

  return {
    exportVersion: ACCOUNT_EXPORT_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    account: {
      publicUid: snapshot.account.publicUid,
      displayName: snapshot.account.displayName,
      role: snapshot.account.role === "owner" ? "owner" : "member",
      accountStatus:
        snapshot.account.accountStatus === "suspended" ? "suspended" : "active",
      createdAt: snapshot.account.createdAt.toISOString(),
      avatarKind: snapshot.account.avatarKind,
    },
    preferences: snapshot.preferences
      ? {
          preferredSpanishRegion: snapshot.preferences.preferredSpanishRegion,
          correctionMode: snapshot.preferences.correctionMode,
          voiceInputPreferred: snapshot.preferences.voiceInputPreferred,
          learningInsightsEnabled: snapshot.preferences.learningInsightsEnabled,
          recordAssistantLearningIntent: snapshot.preferences.recordAssistantLearningIntent,
        }
      : null,
    learning: {
      practiceSessions: mapRows(snapshot.practiceSessions, (row) => ({
        id: row.id,
        status: row.status,
        primaryModality: row.primaryModality,
        contentVersion: row.contentVersion,
        startedAt: iso(row.startedAt),
        completedAt: iso(row.completedAt),
      })),
      practiceAttempts: mapRows(snapshot.practiceAttempts, (row) => ({
        id: row.id,
        sessionId: row.sessionId,
        modality: row.modality,
        responseText: row.responseText,
        hintLevel: row.hintLevel,
        transcriptConfidence: row.transcriptConfidence,
        contentVersion: row.contentVersion,
        algorithmVersion: row.algorithmVersion,
        createdAt: iso(row.createdAt),
      })),
      evidenceEvents: mapRows(snapshot.evidenceEvents, (row) => ({
        id: row.id,
        practiceAttemptId: row.practiceAttemptId,
        skillKey: row.skillKey,
        modality: row.modality,
        outcomeScore: row.outcomeScore,
        evidenceWeight: row.evidenceWeight,
        confidence: row.confidence,
        contentVersion: row.contentVersion,
        algorithmVersion: row.algorithmVersion,
        occurredAt: iso(row.occurredAt),
      })),
      skillStates: mapRows(snapshot.skillStates, (row) => ({
        skillKey: row.skillKey,
        mastery: row.mastery,
        confidence: row.confidence,
        evidenceCount: row.evidenceCount,
        lastEvidenceAt: iso(row.lastEvidenceAt),
        snapshotVersion: row.snapshotVersion,
      })),
      learningBreakpoints: mapRows(snapshot.learningBreakpoints, (row) => ({
        sessionId: row.sessionId,
        state: row.state,
        generation: row.generation,
        expiresAt: iso(row.expiresAt),
        updatedAt: iso(row.updatedAt),
      })),
      sceneStates: mapRows(snapshot.sceneStates, (row) => ({
        scenarioId: row.scenarioId,
        status: row.status,
        mastery: row.mastery,
        confidence: row.confidence,
        oralCoverage: row.oralCoverage,
        evidenceCount: row.evidenceCount,
        lastVerifiedAt: iso(row.lastVerifiedAt),
        snapshotVersion: row.snapshotVersion,
      })),
      observations: mapRows(snapshot.learningObservations, (row) => ({
        eventType: row.eventType,
        sourceModule: row.sourceModule,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        subjectVersion: row.subjectVersion,
        signalStrength: row.signalStrength,
        metadata: row.metadata,
        occurredAt: iso(row.occurredAt),
        dedupeKey: row.dedupeKey,
        algorithmVersion: row.algorithmVersion,
      })),
      insightReports: mapRows(snapshot.learningInsightReports, (row) => ({
        localDate: row.localDate,
        timezone: row.timezone,
        reportVersion: row.reportVersion,
        status: row.status,
        coverage: row.coverage,
        summary: row.summary,
        candidates: row.candidates,
        sourceEventIds: row.sourceEventIds,
        algorithmVersion: row.algorithmVersion,
      })),
      insightFeedback: mapRows(snapshot.learningInsightFeedback, (row) => ({
        reportId: row.reportId,
        candidateKey: row.candidateKey,
        feedback: row.feedback,
        dedupeKey: row.dedupeKey,
        createdAt: iso(row.createdAt),
      })),
    },
    reading: {
      progress: mapRows(snapshot.readingProgress, (row) => ({
        articleVersionId: row.articleVersionId,
        contentHash: row.contentHash,
        position: row.position,
        status: row.status,
        note: row.note,
        lastOpenedAt: iso(row.lastOpenedAt),
      })),
      saves: mapRows(snapshot.articleSaves, (row) => ({
        articleVersionId: row.articleVersionId,
        createdAt: iso(row.createdAt),
      })),
      highlights: mapRows(snapshot.articleHighlights, (row) => ({
        articleVersionId: row.articleVersionId,
        itemType: row.itemType,
        segmentPosition: row.segmentPosition,
        text: row.text,
        createdAt: iso(row.createdAt),
      })),
      savedSources: mapRows(snapshot.savedSources, (row) => ({
        sourceUrl: row.sourceUrl,
        normalizedUrl: row.normalizedUrl,
        title: row.title,
        author: row.author,
        sourceName: row.sourceName,
        license: row.license,
        copyrightStatus: row.copyrightStatus,
        status: row.status,
        createdAt: iso(row.createdAt),
      })),
    },
    media: {
      progress: mapRows(snapshot.mediaProgress, (row) => ({
        mediaVersionId: row.mediaVersionId,
        lastPositionMs: row.lastPositionMs,
        lastSegmentIndex: row.lastSegmentIndex,
        status: row.status,
        lastOpenedAt: iso(row.lastOpenedAt),
      })),
    },
    ...(snapshot.relationships ? { relationships: snapshot.relationships } : {}),
    vocabularyMarks: snapshot.vocabularyMarks.rows.map((row) => ({ word: row.word, status: row.status, updatedAt: row.updatedAt.toISOString() })),
    vocabularyRecallProgress: snapshot.vocabularyRecallProgress.rows.map((row) => ({ ...row, nextReviewAt: row.nextReviewAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() })),
    savedExpressions: mapRows(snapshot.savedExpressions, (row) => ({
      sourceText: row.sourceText,
      translation: row.translation,
      register: row.register,
      usageNotes: row.usageNotes,
      sourceType: row.sourceType,
      archived: row.archived,
      createdAt: iso(row.createdAt),
    })),
    conversations: snapshot.conversations.rows.map((conversation) => ({
      characterKey: conversation.characterKey,
      createdAt: conversation.createdAt.toISOString(),
      messages: messagesByConversation.get(conversation.id) ?? [],
    })),
    truncated: {
      conversations: snapshot.conversations.truncated,
      messages: snapshot.messages.truncated,
      categories: truncated,
    },
  };
}
