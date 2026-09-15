import { TranslationError, type TranslationProvider } from "@/src/modules/providers/translation/translation";
import type { DraftMediaSegment } from "@/src/modules/media/domain";

export type MediaTranslationResult = Readonly<{
  segments: readonly DraftMediaSegment[];
  translatedCount: number;
  failedCount: number;
  estimatedCostMicros: number;
  errors: readonly string[];
}>;

export async function translateMediaSegments(input: Readonly<{
  segments: readonly DraftMediaSegment[];
  provider: TranslationProvider;
  sourceLocale?: string;
  targetLocale?: string;
  signal?: AbortSignal;
}>): Promise<MediaTranslationResult> {
  let translatedCount = 0;
  let failedCount = 0;
  let estimatedCostMicros = 0;
  const errors: string[] = [];
  const segments: DraftMediaSegment[] = [];
  for (const segment of input.segments) {
    try {
      const result = await input.provider.translate({ text: segment.sourceText, sourceLocale: input.sourceLocale ?? "es-ES", targetLocale: input.targetLocale ?? "zh-CN" }, { signal: input.signal });
      segments.push({ ...segment, translation: result.text.trim() || null });
      if (result.text.trim()) translatedCount += 1;
      estimatedCostMicros += result.estimatedCostMicros ?? 0;
    } catch (error) {
      if (input.signal?.aborted || (error instanceof TranslationError && error.code === "provider-cancelled")) throw error;
      failedCount += 1;
      const code = error instanceof TranslationError ? error.code : "provider-unavailable";
      errors.push(code);
      segments.push({ ...segment, translation: null });
    }
  }
  return { segments, translatedCount, failedCount, estimatedCostMicros, errors };
}
