import { randomUUID } from "node:crypto";

import { processMediaCandidate, type MediaAudioAssetProvider, type TemporaryMediaAudio } from "@/src/modules/content-acquisition/application/process-media-candidate";
import type { ProcessingBudgetPolicy, ProcessingBudgetUsage } from "@/src/modules/content-acquisition/domain/budget-policy";
import type { SpeechToTextProvider } from "@/src/modules/providers/stt/transcription";
import type { TranslationProvider } from "@/src/modules/providers/translation/translation";
import type { MediaTranscriptBackfillRepository } from "../repositories";

export type PublishedMediaTranscriptCandidate = Readonly<{
  id: string;
  stableKey: string;
  mediaItemId: string;
  mediaVersionId: string;
  version: number;
  contentType: "video" | "podcast";
  language: string;
  rightsStatus: "unknown" | "verified" | "restricted" | "revoked";
  durationMs: number;
  assetBytes: number;
  mimeType: string;
  fileName: string;
  contentHash: string | null;
}>;

export async function backfillPublishedMediaTranscript(input: Readonly<{
  candidate: PublishedMediaTranscriptCandidate;
  audio: MediaAudioAssetProvider;
  transcriptionProvider: SpeechToTextProvider;
  translationProvider?: TranslationProvider;
  repository: MediaTranscriptBackfillRepository;
  budgetPolicy: ProcessingBudgetPolicy;
  budgetUsage: ProcessingBudgetUsage;
  estimatedCostMicros: number;
  generationId?: string;
  replaceExistingDraft?: boolean;
  signal?: AbortSignal;
  now?: () => Date;
}>): Promise<Readonly<{ backfillId: string; segments: number; lowConfidence: boolean; cleanupStatus: string }>> {
  const capture: { asset?: TemporaryMediaAudio } = {};
  const processingAudio: MediaAudioAssetProvider = {
    acquire: async (candidate, options) => {
      const asset = await input.audio.acquire(candidate, options);
      capture.asset = asset;
      return asset;
    },
    release: (asset) => input.audio.release(asset),
  };
  const result = await processMediaCandidate({
    candidate: input.candidate,
    audio: processingAudio,
    transcriptionProvider: input.transcriptionProvider,
    translationProvider: input.translationProvider,
    budgetPolicy: input.budgetPolicy,
    budgetUsage: input.budgetUsage,
    estimatedCostMicros: input.estimatedCostMicros,
    generationId: input.generationId,
    signal: input.signal,
    now: input.now,
  });
  if (result.status !== "succeeded" || result.transcriptSource === "platform_manual" || result.transcriptSource === "platform_auto") {
    throw new Error("MEDIA_TRANSCRIPT_BACKFILL_NOT_REQUIRED");
  }
  const createdAt = (input.now ?? (() => new Date()))();
  const capturedHash = capture.asset?.contentHash;
  if (!capturedHash) throw new Error("MEDIA_TRANSCRIPT_AUDIO_MISSING");
  const draft = {
    id: randomUUID(),
    mediaStableKey: input.candidate.stableKey,
    mediaVersionId: input.candidate.mediaVersionId,
    mediaItemId: input.candidate.mediaItemId,
    sourceVersion: input.candidate.version,
    audioHash: capturedHash,
    segments: result.segments,
    provider: result.provider ?? "asr",
    modelVersion: result.modelVersion ?? "unknown",
    lowConfidence: result.lowConfidence,
    translationFailedCount: result.translationFailedCount,
    createdAt,
  };
  const record = input.replaceExistingDraft
    ? await (() => {
      if (!input.repository.replaceTranscriptBackfillDraft) throw new Error("MEDIA_TRANSCRIPT_DRAFT_REPLACEMENT_UNAVAILABLE");
      return input.repository.replaceTranscriptBackfillDraft({
        ...draft,
        updatedAt: createdAt,
      });
    })()
    : await input.repository.createTranscriptBackfill(draft);
  return { backfillId: record.id, segments: record.segments.length, lowConfidence: record.lowConfidence, cleanupStatus: result.cleanupStatus };
}
