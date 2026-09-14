import { MediaProcessingError, type MediaTranscriptSegment } from "../domain";

export type MediaTranslationInput = Readonly<Pick<MediaTranscriptSegment, "sourceText" | "index">>;
export type MediaTranslationResult = Readonly<{ text: string; providerRequestId: string | null; modelVersion: string; estimatedCostMicros: number }>;

export interface MediaTranslationProvider {
  translate(input: MediaTranslationInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<MediaTranslationResult>;
}

export class FakeMediaTranslationProvider implements MediaTranslationProvider {
  constructor(private readonly translateText: (input: MediaTranslationInput) => string | Promise<string>) {}

  async translate(input: MediaTranslationInput, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<MediaTranslationResult> {
    if (options.signal?.aborted) throw new MediaProcessingError("MEDIA_PROCESSING_CANCELLED", "Media translation was cancelled.");
    const text = (await this.translateText(input)).trim();
    if (!text) throw new MediaProcessingError("MEDIA_TRANSCRIPTION_FAILED", "Media translation returned an empty result.");
    return { text, providerRequestId: null, modelVersion: "fake-media-translation-v1", estimatedCostMicros: 0 };
  }
}
