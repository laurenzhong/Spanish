import { z } from "zod";

import {
  annotationErrorCodes,
  type AnnotationDraft,
  type AnnotationDraftProvider,
  type AnnotationLocale,
} from "../../providers/annotation/annotation";
import {
  transcriptionErrorCodes,
  type SpeechToTextProvider,
  type TranscriptResult,
} from "../../providers/stt/transcription";
import {
  parseReplayAudioManifest,
  type ReplayAudioManifest,
  type ReplayAudioManifestEntry,
} from "./audio-manifest";

const calibrationSampleIdPattern = /^audio\.[a-f0-9]{16}$/;

export const calibrationBatchErrorCodes = [
  ...transcriptionErrorCodes,
  ...annotationErrorCodes,
  "audio-not-found",
  "audio-metadata-mismatch",
  "audio-read-failed",
  "transcript-not-found",
  "transcript-invalid",
] as const;

export type CalibrationBatchErrorCode = (typeof calibrationBatchErrorCodes)[number];
export type CalibrationBatchStage = "audio" | "transcription" | "annotation";

export type CalibrationAudioAsset = Readonly<{
  sha256: string;
  sizeBytes: number;
  format: ReplayAudioManifestEntry["format"];
  audioBytes: Uint8Array;
}>;

export type CalibrationAudioReader = (
  entry: ReplayAudioManifestEntry,
) => Promise<CalibrationAudioAsset | null>;

export type CalibrationTranscriptReader = (
  entry: ReplayAudioManifestEntry,
) => Promise<TranscriptResult | null>;

const annotationObservationSchema = z
  .object({
    category: z.enum(["transcript", "pronunciation", "fluency", "context"]),
    observation: z.string().trim().min(1),
    evidenceBasis: z.enum(["transcript", "speech-signal", "both"]),
    needsHumanReview: z.literal(true),
  })
  .strict();

const annotationDraftSchema = z
  .object({
    status: z.literal("draft"),
    summary: z.string().trim().min(1),
    observations: z.array(annotationObservationSchema).max(12).readonly(),
    questionsForReviewer: z.array(z.string().trim().min(1)).max(12).readonly(),
    safety: z
      .object({
        audioSent: z.literal(false),
        writesEvidence: z.literal(false),
        affectsMastery: z.literal(false),
        affectsConfidence: z.literal(false),
      })
      .strict(),
    provider: z.enum(["minimax", "fake"]),
    modelVersion: z.string().trim().min(1),
    providerRequestId: z.string().trim().min(1).nullable(),
    latencyMs: z.number().int().nonnegative(),
    estimatedCostMicros: z.number().int().nonnegative().nullable(),
    retentionPolicy: z.literal("ephemeral"),
  })
  .strict();

const completedSampleSchema = z
  .object({
    sampleId: z.string().regex(calibrationSampleIdPattern),
    attemptId: z.string().regex(/^calibration\.audio\.[a-f0-9]{16}$/),
    status: z.literal("completed"),
    transcript: z.string().trim().min(1),
    transcriptionProvider: z.enum(["openai", "local-whisper", "fake"]),
    transcriptionModelVersion: z.string().trim().min(1),
    transcriptionLatencyMs: z.number().int().nonnegative(),
    transcriptionRequestId: z.string().trim().min(1).nullable(),
    annotationRequestId: z.string().trim().min(1).nullable(),
    draft: annotationDraftSchema,
    speechSignal: z.null(),
  })
  .strict();

const localTranscriptSampleSchema = z
  .object({
    sampleId: z.string().regex(calibrationSampleIdPattern),
    status: z.literal("completed"),
    transcript: z.string().trim().min(1),
    modelVersion: z.string().trim().min(1),
    language: z.enum(["es-ES", "es-MX"]),
    latencyMs: z.number().int().nonnegative(),
  })
  .strict();

const localTranscriptFailureSchema = z
  .object({
    sampleId: z.string().regex(calibrationSampleIdPattern),
    status: z.literal("failed"),
    errorCode: z.string().trim().min(1),
  })
  .strict();

export const localTranscriptSnapshotSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    provider: z.literal("local-whisper"),
    runId: z.string().trim().min(1),
    modelVersion: z.string().trim().min(1),
    status: z.enum(["completed", "partial-failure"]),
    samples: z.array(z.union([localTranscriptSampleSchema, localTranscriptFailureSchema])),
  })
  .strict();

export type LocalTranscriptSnapshot = z.infer<typeof localTranscriptSnapshotSchema>;

const failedSampleSchema = z
  .object({
    sampleId: z.string().regex(calibrationSampleIdPattern),
    attemptId: z.string().regex(/^calibration\.audio\.[a-f0-9]{16}$/),
    status: z.literal("failed"),
    stage: z.enum(["audio", "transcription", "annotation"]),
    errorCode: z.string().trim().min(1),
    retryable: z.boolean(),
  })
  .strict();

export const calibrationBatchSnapshotSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    runId: z.string().trim().min(1),
    status: z.enum(["running", "completed", "partial-failure", "cancelled"]),
    samples: z.array(z.union([completedSampleSchema, failedSampleSchema])),
  })
  .strict();

export type CalibrationCompletedSample = z.infer<typeof completedSampleSchema>;
export type CalibrationFailedSample = z.infer<typeof failedSampleSchema>;
export type CalibrationPersistedSample =
  | CalibrationCompletedSample
  | CalibrationFailedSample;
export type CalibrationBatchSnapshot = z.infer<
  typeof calibrationBatchSnapshotSchema
>;

export type CalibrationSkippedSample = Readonly<{
  sampleId: string;
  attemptId: string;
  status: "skipped";
  reason: "already-completed" | "previous-failure";
}>;

export type CalibrationSampleResult =
  | CalibrationCompletedSample
  | CalibrationFailedSample
  | CalibrationSkippedSample;

export type CalibrationBatchResult = Readonly<{
  runId: string;
  status: "completed" | "partial-failure" | "cancelled";
  samples: readonly CalibrationSampleResult[];
  snapshot: CalibrationBatchSnapshot;
}>;

export type AnnotationCalibrationOptions = Readonly<{
  manifest: ReplayAudioManifest;
  runId: string;
  contentVersion: string;
  locale: AnnotationLocale;
  readAudio?: CalibrationAudioReader;
  transcriptionProvider?: SpeechToTextProvider;
  readTranscript?: CalibrationTranscriptReader;
  annotationProvider: AnnotationDraftProvider;
  existingSnapshot?: CalibrationBatchSnapshot | null;
  retryFailed?: boolean;
  signal?: AbortSignal;
  writeSnapshot?: (snapshot: CalibrationBatchSnapshot) => Promise<void>;
}>;

export function parseCalibrationBatchSnapshot(
  input: unknown,
): CalibrationBatchSnapshot {
  return calibrationBatchSnapshotSchema.parse(input);
}

export async function runAnnotationCalibrationBatch(
  options: AnnotationCalibrationOptions,
): Promise<CalibrationBatchResult> {
  if (!options.runId.trim() || !options.contentVersion.trim()) {
    throw new Error("Calibration run configuration is incomplete.");
  }
  const audioMode = options.readAudio !== undefined && options.transcriptionProvider !== undefined;
  const transcriptMode = options.readTranscript !== undefined;
  if (audioMode === transcriptMode) {
    throw new Error("Calibration requires exactly one transcription input mode.");
  }
  parseReplayAudioManifest(options.manifest);

  const existingBySampleId = new Map(
    (options.existingSnapshot?.samples ?? []).map((sample) => [sample.sampleId, sample]),
  );
  const persisted = new Map<string, CalibrationPersistedSample>();
  for (const entry of options.manifest.entries) {
    const prior = existingBySampleId.get(entry.sampleId);
    if (prior) persisted.set(entry.sampleId, prior);
  }

  const samples: CalibrationSampleResult[] = [];
  let cancelled = false;

  for (const entry of options.manifest.entries) {
    const attemptId = `calibration.${entry.sampleId}`;
    const prior = persisted.get(entry.sampleId);
    if (prior?.status === "completed") {
      samples.push({ sampleId: entry.sampleId, attemptId, status: "skipped", reason: "already-completed" });
      continue;
    }
    if (prior?.status === "failed" && !options.retryFailed) {
      samples.push({ sampleId: entry.sampleId, attemptId, status: "skipped", reason: "previous-failure" });
      continue;
    }
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }

    const failure = await processSample(entry, attemptId, options);
    if (failure.status === "failed") {
      persisted.set(entry.sampleId, failure);
      samples.push(failure);
      await persist(options, options.runId, "running", persisted, options.manifest);
      if (failure.errorCode === "provider-cancelled") {
        cancelled = true;
        break;
      }
      continue;
    }

    persisted.set(entry.sampleId, failure);
    samples.push(failure);
    await persist(options, options.runId, "running", persisted, options.manifest);
  }

  const status = cancelled
    ? "cancelled"
    : [...persisted.values()].some((sample) => sample.status === "failed")
      ? "partial-failure"
      : "completed";
  const snapshot = makeSnapshot(options.runId, status, persisted, options.manifest);
  await options.writeSnapshot?.(snapshot);
  return { runId: options.runId, status, samples, snapshot };
}

async function processSample(
  entry: ReplayAudioManifestEntry,
  attemptId: string,
  options: AnnotationCalibrationOptions,
): Promise<CalibrationCompletedSample | CalibrationFailedSample> {
  let transcript: TranscriptResult;
  if (options.readTranscript) {
    try {
      const result = await options.readTranscript(entry);
      if (!result) return failed(entry.sampleId, attemptId, "transcription", "transcript-not-found", false);
      transcript = result;
    } catch {
      return failed(entry.sampleId, attemptId, "transcription", "transcript-invalid", false);
    }
  } else {
    let asset: CalibrationAudioAsset | null;
    try {
      asset = await options.readAudio!(entry);
    } catch {
      return failed(entry.sampleId, attemptId, "audio", "audio-read-failed", false);
    }
    if (!asset) return failed(entry.sampleId, attemptId, "audio", "audio-not-found", false);
    if (
      asset.sha256 !== entry.sha256 ||
      asset.sizeBytes !== entry.sizeBytes ||
      asset.format !== entry.format ||
      asset.audioBytes.byteLength !== entry.sizeBytes
    ) {
      return failed(entry.sampleId, attemptId, "audio", "audio-metadata-mismatch", false);
    }
    try {
      transcript = await options.transcriptionProvider!.transcribe(
        {
          audioBytes: asset.audioBytes,
          mimeType: mimeTypeForFormat(entry.format),
          fileName: `${entry.sampleId}${entry.format}`,
          languageTag: options.locale,
        },
        { signal: options.signal },
      );
    } catch (error) {
      return failed(entry.sampleId, attemptId, "transcription", stableErrorCode(error, "provider-unavailable"), isRetryable(error));
    }
  }
  if (!transcript.text.trim()) {
    return failed(entry.sampleId, attemptId, "transcription", "provider-response-invalid", false);
  }

  let draft: AnnotationDraft;
  try {
    draft = await options.annotationProvider.createDraft(
      {
        transcript: transcript.text,
        locale: options.locale,
        contentVersion: options.contentVersion,
        attemptId,
        generationId: 0,
        speechSignal: null,
      },
      { signal: options.signal },
    );
  } catch (error) {
    return failed(entry.sampleId, attemptId, "annotation", stableErrorCode(error, "provider-unavailable"), isRetryable(error));
  }

  return {
    sampleId: entry.sampleId,
    attemptId,
    status: "completed",
    transcript: transcript.text,
    transcriptionProvider: transcript.provider,
    transcriptionModelVersion: transcript.modelVersion,
    transcriptionLatencyMs: transcript.latencyMs,
    transcriptionRequestId: transcript.providerRequestId,
    annotationRequestId: draft.providerRequestId,
    draft,
    speechSignal: null,
  };
}

function failed(
  sampleId: string,
  attemptId: string,
  stage: CalibrationBatchStage,
  errorCode: CalibrationBatchErrorCode,
  retryable: boolean,
): CalibrationFailedSample {
  return { sampleId, attemptId, status: "failed", stage, errorCode, retryable };
}

async function persist(
  options: AnnotationCalibrationOptions,
  runId: string,
  status: CalibrationBatchSnapshot["status"],
  persisted: Map<string, CalibrationPersistedSample>,
  manifest: ReplayAudioManifest,
): Promise<void> {
  await options.writeSnapshot?.(makeSnapshot(runId, status, persisted, manifest));
}

function makeSnapshot(
  runId: string,
  status: CalibrationBatchSnapshot["status"],
  persisted: Map<string, CalibrationPersistedSample>,
  manifest: ReplayAudioManifest,
): CalibrationBatchSnapshot {
  return {
    schemaVersion: "1.0",
    runId,
    status,
    samples: manifest.entries
      .map((entry) => persisted.get(entry.sampleId))
      .filter((sample): sample is CalibrationPersistedSample => sample !== undefined),
  };
}

function mimeTypeForFormat(format: ReplayAudioManifestEntry["format"]): string {
  if (format === ".mp3") return "audio/mpeg";
  if (format === ".wav") return "audio/wav";
  if (format === ".m4a") return "audio/mp4";
  if (format === ".webm") return "audio/webm";
  return "audio/ogg";
}

function stableErrorCode(
  error: unknown,
  fallback: CalibrationBatchErrorCode,
): CalibrationBatchErrorCode {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  return typeof code === "string" && (calibrationBatchErrorCodes as readonly string[]).includes(code)
    ? code as CalibrationBatchErrorCode
    : fallback;
}

function isRetryable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "retryable" in error
    ? (error as { retryable?: unknown }).retryable === true
    : false;
}
