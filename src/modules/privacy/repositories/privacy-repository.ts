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

export type PrivacyRepository = Readonly<{
  deleteSavedAudio(userId: string, audioAssetId: string): Promise<boolean>;
  deleteTranscript(userId: string, attemptId: string): Promise<boolean>;
  listSavedAudio(userId: string): Promise<readonly SavedAudioRecord[]>;
  listTranscripts(userId: string): Promise<readonly SavedTranscriptRecord[]>;
}>;
