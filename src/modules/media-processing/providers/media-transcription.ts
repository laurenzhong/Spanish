import { MediaProcessingError, type RawTranscriptSegment } from "../domain";

export type MediaTranscriptionInput = Readonly<{
  candidateId: string;
  mediaType: "video" | "podcast";
  language: "es";
  durationMs: number;
  assetBytes: number;
  assetPath: string;
}>;

export type MediaTranscriptionEvent =
  | Readonly<{ type: "segment"; segment: RawTranscriptSegment }>
  | Readonly<{ type: "done"; providerRequestId: string | null; modelVersion: string; estimatedCostMicros: number }>
  | Readonly<{ type: "error"; code: "provider-unavailable" | "provider-rate-limited" | "provider-response-invalid"; message: string }>;

export interface MediaTranscriptionProvider {
  transcribe(input: MediaTranscriptionInput, options?: Readonly<{ signal?: AbortSignal }>): AsyncIterable<MediaTranscriptionEvent>;
}

export type ConsumedTranscription = Readonly<{
  segments: readonly RawTranscriptSegment[];
  providerRequestId: string | null;
  modelVersion: string;
  estimatedCostMicros: number;
}>;

export async function consumeMediaTranscription(
  stream: AsyncIterable<MediaTranscriptionEvent>,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<ConsumedTranscription> {
  const segments: RawTranscriptSegment[] = [];
  let done: Extract<MediaTranscriptionEvent, { type: "done" }> | null = null;
  for await (const event of stream) {
    if (options.signal?.aborted) throw new MediaProcessingError("MEDIA_PROCESSING_CANCELLED", "Media transcription was cancelled.");
    if (event.type === "segment") segments.push(event.segment);
    if (event.type === "error") throw new MediaProcessingError("MEDIA_TRANSCRIPTION_FAILED", event.message, true);
    if (event.type === "done") done = event;
  }
  if (!done) throw new MediaProcessingError("MEDIA_TRANSCRIPTION_INCOMPLETE", "Media transcription ended without a done event.", true);
  if (!Number.isSafeInteger(done.estimatedCostMicros) || done.estimatedCostMicros < 0) {
    throw new MediaProcessingError("MEDIA_TRANSCRIPTION_FAILED", "Media transcription returned an invalid cost.");
  }
  return { segments, providerRequestId: done.providerRequestId, modelVersion: done.modelVersion, estimatedCostMicros: done.estimatedCostMicros };
}

export class FakeMediaTranscriptionProvider implements MediaTranscriptionProvider {
  constructor(private readonly events: readonly MediaTranscriptionEvent[]) {}

  async *transcribe(input: MediaTranscriptionInput): AsyncIterable<MediaTranscriptionEvent> {
    void input;
    for (const event of this.events) yield event;
  }
}
