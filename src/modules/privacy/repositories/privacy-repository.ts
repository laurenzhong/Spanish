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

export type PrivacyRepository = Readonly<{
  transaction<T>(work: (repository: PrivacyRepository) => Promise<T>): Promise<T>;
  getAccountDataSummary(userId: string): Promise<AccountDataSummary>;
  deleteAccountData(userId: string): Promise<AccountDataDeletionResult>;
  deleteCharacterData(userId: string, characterKey: string): Promise<CharacterDataDeletionResult>;
  deleteSavedAudio(userId: string, audioAssetId: string): Promise<boolean>;
  deleteTranscript(userId: string, attemptId: string): Promise<boolean>;
  listSavedAudio(userId: string): Promise<readonly SavedAudioRecord[]>;
  listTranscripts(userId: string): Promise<readonly SavedTranscriptRecord[]>;
  updateStorageCleanupTask(
    taskId: string,
    status: StorageCleanupStatus,
    errorMessage?: string,
  ): Promise<boolean>;
}>;
