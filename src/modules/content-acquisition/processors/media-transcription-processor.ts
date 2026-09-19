import type { SpeechToTextProvider, TranscriptResult } from "@/src/modules/providers/stt/transcription";
import { maxTranscriptionAudioBytes, normalizeTranscriptionMimeType } from "@/src/modules/providers/stt/transcription";
import { segmentMediaTranscript } from "./media-segmentation";
import { validateSegmentTimeline, type DraftMediaSegment } from "@/src/modules/media/domain";

export type MediaAudioChunk = Readonly<{ bytes: Uint8Array; startMs: number; endMs: number; index: number }>;

export type MediaTranscriptionResult = Readonly<{
  text: string;
  confidence: number | null;
  detectedLanguages: readonly string[];
  provider: TranscriptResult["provider"];
  modelVersion: string;
  providerRequestIds: readonly string[];
  estimatedCostMicros: number;
  latencyMs: number;
  chunks: readonly MediaAudioChunk[];
  segments: readonly ReturnType<typeof segmentMediaTranscript>[number][];
}>;

export class MediaTranscriptionError extends Error {
  readonly code = "MEDIA_TRANSCRIPTION_FAILED" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MediaTranscriptionError";
  }
}

export function splitMediaAudio(bytes: Uint8Array, durationMs: number, maxBytes = maxTranscriptionAudioBytes, maxDurationMs = 500_000): MediaAudioChunk[] {
  if (bytes.byteLength === 0 || !Number.isInteger(durationMs) || durationMs <= 0) throw new MediaTranscriptionError("Audio bytes and duration are required.");
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || !Number.isInteger(maxDurationMs) || maxDurationMs <= 0) throw new MediaTranscriptionError("The audio chunk limit is invalid.");
  const byteLimitForDuration = Math.max(1, Math.ceil(bytes.byteLength * Math.min(maxDurationMs, durationMs) / durationMs));
  const chunkByteLimit = Math.min(maxBytes, byteLimitForDuration);
  const chunks: MediaAudioChunk[] = [];
  for (let offset = 0, index = 0; offset < bytes.byteLength; offset += chunkByteLimit, index += 1) {
    const chunkBytes = bytes.slice(offset, Math.min(bytes.byteLength, offset + chunkByteLimit));
    const startMs = Math.floor(durationMs * offset / bytes.byteLength);
    const endMs = offset + chunkBytes.byteLength >= bytes.byteLength
      ? durationMs
      : Math.max(startMs + 1, Math.floor(durationMs * (offset + chunkBytes.byteLength) / bytes.byteLength));
    chunks.push({ bytes: chunkBytes, startMs, endMs, index });
  }
  return chunks;
}

function assertCompleteResult(result: unknown): asserts result is TranscriptResult {
  if (!result || typeof result !== "object") throw new MediaTranscriptionError("The transcription provider returned an invalid result.");
  const record = result as Record<string, unknown>;
  if (record.done === false) throw new MediaTranscriptionError("The transcription stream ended without done.");
  if (typeof record.text !== "string" || !record.text.trim()) throw new MediaTranscriptionError("The transcription provider returned empty text.");
}

export async function transcribeMediaAudio(input: Readonly<{
  audioBytes: Uint8Array;
  durationMs: number;
  mimeType: string;
  fileName: string;
  languageTag?: string;
  provider: SpeechToTextProvider;
  signal?: AbortSignal;
  maxChunkBytes?: number;
  maxChunkDurationMs?: number;
  preparedChunks?: readonly MediaAudioChunk[];
}>): Promise<MediaTranscriptionResult> {
  const mimeType = normalizeTranscriptionMimeType(input.mimeType);
  const chunks = input.preparedChunks ? [...input.preparedChunks] : splitMediaAudio(input.audioBytes, input.durationMs, input.maxChunkBytes, input.maxChunkDurationMs);
  if (input.preparedChunks && (!chunks.length || chunks.some((chunk, index) => chunk.index !== index || chunk.startMs !== (index ? chunks[index - 1].endMs : 0) || chunk.endMs <= chunk.startMs || chunk.endMs - chunk.startMs > 500_000 || chunk.bytes.byteLength === 0 || chunk.bytes.byteLength > maxTranscriptionAudioBytes) || Math.abs(chunks.at(-1)!.endMs - input.durationMs) > 1000)) throw new MediaTranscriptionError("Prepared audio chunks do not cover the media timeline.");
  const startedAt = Date.now();
  const results: TranscriptResult[] = [];
  for (const chunk of chunks) {
    if (input.signal?.aborted) throw new MediaTranscriptionError("Transcription was cancelled.");
    let result: unknown;
    try {
      result = await input.provider.transcribe({ audioBytes: chunk.bytes, mimeType, fileName: `${input.fileName}.part-${chunk.index + 1}`, languageTag: input.languageTag }, { signal: input.signal });
    } catch (error) {
      throw new MediaTranscriptionError(`Transcription chunk ${chunk.index + 1} failed.`, { cause: error });
    }
    assertCompleteResult(result);
    results.push(result);
  }
  const text = results.map((result) => result.text.trim()).join(" ").trim();
  const confidences = results.map((result) => result.confidence).filter((value): value is number => typeof value === "number");
  const confidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null;
  const first = results[0];
  const estimatedCostMicros = results.reduce((sum, result) => sum + (result.estimatedCostMicros ?? 0), 0);
  const timedSegments = results.every((result) => result.segments && result.segments.length > 0)
    ? results.flatMap((result, chunkIndex) => {
      const chunk = chunks[chunkIndex];
      const chunkEndMs = Math.min(chunk.endMs, input.durationMs);
      return (result.segments ?? []).flatMap((segment): DraftMediaSegment[] => {
        const startMs = chunk.startMs + segment.startMs;
        const endMs = Math.min(chunk.startMs + segment.endMs, chunkEndMs);
        if (endMs <= startMs) return [];
        const words = segment.words?.flatMap((word) => {
          const wordStartMs = Math.max(startMs, chunk.startMs + word.startMs);
          const wordEndMs = Math.min(endMs, chunk.startMs + word.endMs);
          return wordEndMs > wordStartMs ? [{ ...word, startMs: wordStartMs, endMs: wordEndMs }] : [];
        });
        return [{
          index: 0,
          startMs,
          endMs,
          sourceText: segment.text.trim(),
          words,
          translation: null,
          speaker: segment.speaker,
          confidence: segment.confidence,
          sourceKind: "asr",
        }];
      });
    }).map((segment, index) => ({ ...segment, index }))
    : null;
  const segments = timedSegments && timedSegments.length > 0
    ? timedSegments
    : segmentMediaTranscript({ text, durationMs: input.durationMs, confidence });
  try {
    validateSegmentTimeline(segments, input.durationMs);
  } catch (error) {
    throw new MediaTranscriptionError(error instanceof Error ? error.message : "The transcription timeline is invalid.", { cause: error });
  }
  return {
    text,
    confidence,
    detectedLanguages: [...new Set(results.flatMap((result) => result.detectedLanguages))],
    provider: first.provider,
    modelVersion: first.modelVersion,
    providerRequestIds: results.map((result) => result.providerRequestId).filter((id): id is string => Boolean(id)),
    estimatedCostMicros,
    latencyMs: Math.max(0, Date.now() - startedAt),
    chunks,
    segments,
  };
}
