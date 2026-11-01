export type SavedAudioRecord = Readonly<{
  createdAt: Date;
  durationMs: number | null;
  id: string;
  mimeType: string;
  purpose: string;
  retentionPolicy: string;
  sizeBytes: number;
}>;

export type SavedTranscriptRecord = Readonly<{
  attemptId: string;
  createdAt: Date;
  text: string;
}>;

export type StorageCleanupTask = Readonly<{
  id: string;
  storageBucket: string;
  storagePath: string;
}>;

export type AccountDataDeletionResult = Readonly<{
  alreadyDeleted: boolean;
  cleanupTasks: readonly StorageCleanupTask[];
  evidenceDeleted: number;
  providerCallsAnonymized: number;
}>;

/**
 * Business-data clear step used by the account-deletion orchestration: it does
 * everything `deleteAccountData` does except deleting the `profiles` row, which
 * is kept as a tombstone until the Supabase Auth user is removed. This keeps an
 * interrupted account deletion discoverable and retryable.
 */
export type AccountBusinessDataDeletionResult = AccountDataDeletionResult;

export type AccountDataSummary = Readonly<{
  conversations: number;
  evidenceEvents: number;
  practiceAttempts: number;
  relationshipMemories: number;
  savedAudio: number;
  savedTranscripts: number;
  sessions: number;
}>;

export type CharacterDataDeletionResult = Readonly<{
  characterKey: string;
  conversationsDeleted: number;
  messagesDeleted: number;
  relationshipMemoriesDeleted: number;
  memoryPermissionsRevoked: number;
  relationshipSnapshotsDeleted: number;
}>;

export type StorageCleanupStatus = "completed" | "failed" | "pending";

/**
 * Data-export limits (ACCT-ADMIN-001, design §5.3). Each ordinary collection is
 * capped at 2,000 rows; conversations at 200 and messages at 5,000. Callers must
 * report truncation explicitly instead of silently dropping rows.
 */
export type AccountExportLimits = Readonly<{
  perCategory: number;
  conversations: number;
  messages: number;
}>;

export type ExportedAccountProfile = Readonly<{
  publicUid: string;
  displayName: string | null;
  role: string;
  accountStatus: string;
  avatarKind: string;
  createdAt: Date;
}>;

export type ExportedPreferences = Readonly<{
  preferredSpanishRegion: string;
  correctionMode: string;
  voiceInputPreferred: string;
  learningInsightsEnabled: boolean;
  recordAssistantLearningIntent: boolean;
}>;

export type ExportedPracticeSession = Readonly<{
  id: string;
  status: string;
  primaryModality: string;
  contentVersion: number;
  startedAt: Date;
  completedAt: Date | null;
}>;

export type ExportedPracticeAttempt = Readonly<{
  id: string;
  sessionId: string;
  modality: string;
  responseText: string | null;
  hintLevel: number;
  transcriptConfidence: number | null;
  contentVersion: number;
  algorithmVersion: string;
  createdAt: Date;
}>;

export type ExportedEvidenceEvent = Readonly<{
  id: string;
  practiceAttemptId: string | null;
  skillKey: string;
  modality: string;
  outcomeScore: number;
  evidenceWeight: number;
  confidence: number;
  contentVersion: number;
  algorithmVersion: string;
  occurredAt: Date;
}>;

export type ExportedSkillState = Readonly<{
  skillKey: string;
  mastery: number;
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  snapshotVersion: number;
}>;

export type ExportedLearningBreakpoint = Readonly<{
  sessionId: string;
  state: Record<string, unknown>;
  generation: number;
  expiresAt: Date | null;
  updatedAt: Date;
}>;

export type ExportedSceneState = Readonly<{
  scenarioId: string;
  status: string;
  mastery: number;
  confidence: number;
  oralCoverage: number;
  evidenceCount: number;
  lastVerifiedAt: Date | null;
  snapshotVersion: number;
}>;

export type ExportedReadingProgress = Readonly<{
  articleVersionId: string;
  contentHash: string;
  position: number;
  status: string;
  note: string;
  lastOpenedAt: Date;
}>;

export type ExportedArticleSave = Readonly<{
  articleVersionId: string;
  createdAt: Date;
}>;

export type ExportedArticleHighlight = Readonly<{
  articleVersionId: string;
  itemType: string;
  segmentPosition: number;
  text: string;
  createdAt: Date;
}>;

export type ExportedSavedArticleSource = Readonly<{
  sourceUrl: string;
  normalizedUrl: string;
  title: string | null;
  author: string | null;
  sourceName: string | null;
  license: string | null;
  copyrightStatus: string;
  status: string;
  createdAt: Date;
}>;

export type ExportedMediaProgress = Readonly<{
  mediaVersionId: string;
  lastPositionMs: number;
  lastSegmentIndex: number | null;
  status: string;
  lastOpenedAt: Date;
}>;

export type ExportedSavedExpression = Readonly<{
  sourceText: string;
  translation: string | null;
  register: string | null;
  usageNotes: string | null;
  sourceType: string;
  archived: boolean;
  createdAt: Date;
}>;

export type ExportedLearningObservation = Readonly<{
  eventType: string;
  sourceModule: string;
  subjectType: string;
  subjectId: string | null;
  subjectVersion: number | null;
  signalStrength: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
  dedupeKey: string;
  algorithmVersion: string;
}>;

export type ExportedLearningInsightReport = Readonly<{
  localDate: string;
  timezone: string;
  reportVersion: number;
  status: string;
  coverage: Record<string, unknown>;
  summary: string;
  candidates: readonly unknown[];
  sourceEventIds: readonly string[];
  algorithmVersion: string;
}>;

export type ExportedLearningInsightFeedback = Readonly<{
  reportId: string;
  candidateKey: string;
  feedback: string;
  dedupeKey: string;
  createdAt: Date;
}>;

export type ExportedConversation = Readonly<{
  id: string;
  characterKey: string;
  createdAt: Date;
}>;

export type ExportedMessage = Readonly<{
  conversationId: string;
  role: string;
  status: string;
  content: string;
  createdAt: Date;
}>;

export type AccountExportCollection<T> = Readonly<{
  rows: readonly T[];
  truncated: boolean;
}>;

/**
 * Whitelisted export snapshot. Never contains recordings/media binaries, Storage
 * paths, signed URLs, internal Auth ids, provider calls, relationship memories,
 * other users' data or credentials.
 */
export type AccountExportSnapshot = Readonly<{
  account: ExportedAccountProfile | null;
  preferences: ExportedPreferences | null;
  practiceSessions: AccountExportCollection<ExportedPracticeSession>;
  practiceAttempts: AccountExportCollection<ExportedPracticeAttempt>;
  evidenceEvents: AccountExportCollection<ExportedEvidenceEvent>;
  skillStates: AccountExportCollection<ExportedSkillState>;
  learningBreakpoints: AccountExportCollection<ExportedLearningBreakpoint>;
  sceneStates: AccountExportCollection<ExportedSceneState>;
  readingProgress: AccountExportCollection<ExportedReadingProgress>;
  articleSaves: AccountExportCollection<ExportedArticleSave>;
  articleHighlights: AccountExportCollection<ExportedArticleHighlight>;
  savedSources: AccountExportCollection<ExportedSavedArticleSource>;
  mediaProgress: AccountExportCollection<ExportedMediaProgress>;
  savedExpressions: AccountExportCollection<ExportedSavedExpression>;
  vocabularyMarks: AccountExportCollection<{ word: string; status: string | null; updatedAt: Date }>;
  vocabularyRecallProgress: AccountExportCollection<{
    word: string; mode: string; stage: string; revision: number; successfulReviews: number; nextReviewAt: Date | null; updatedAt: Date;
  }>;
  learningObservations: AccountExportCollection<ExportedLearningObservation>;
  learningInsightReports: AccountExportCollection<ExportedLearningInsightReport>;
  learningInsightFeedback: AccountExportCollection<ExportedLearningInsightFeedback>;
  conversations: AccountExportCollection<ExportedConversation>;
  messages: AccountExportCollection<ExportedMessage>;
  /** Optional until the relationship migration is installed; never contains raw message text. */
  relationships?: RelationshipExportDto;
}>;

export type PrivacyRepository = Readonly<{
  transaction<T>(work: (repository: PrivacyRepository) => Promise<T>): Promise<T>;
  getAccountDataSummary(userId: string): Promise<AccountDataSummary>;
  deleteAccountData(userId: string): Promise<AccountDataDeletionResult>;
  /**
   * Clear business data but keep the `profiles` tombstone row (account deletion
   * retryability). `alreadyDeleted` is true when the profile is already gone.
   */
  clearAccountBusinessData(
    userId: string,
  ): Promise<AccountBusinessDataDeletionResult>;
  /** Delete the profile row after the Auth user removal; true when removed. */
  deleteAccountProfile(userId: string): Promise<boolean>;
  deleteCharacterData(userId: string, characterKey: string): Promise<CharacterDataDeletionResult>;
  deleteSavedAudio(userId: string, audioAssetId: string): Promise<boolean>;
  deleteTranscript(userId: string, attemptId: string): Promise<boolean>;
  listSavedAudio(userId: string): Promise<readonly SavedAudioRecord[]>;
  listTranscripts(userId: string): Promise<readonly SavedTranscriptRecord[]>;
  readAccountExport(
    userId: string,
    limits: AccountExportLimits,
  ): Promise<AccountExportSnapshot>;
  updateStorageCleanupTask(
    taskId: string,
    status: StorageCleanupStatus,
    errorMessage?: string,
  ): Promise<boolean>;
}>;
import type { RelationshipExportDto } from "@/src/modules/character-network/application/relationship-privacy";
