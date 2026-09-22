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
  concurrency?: number;
}>): Promise<MediaTranslationResult> {
  const concurrency = Math.max(1, Math.min(4, Math.floor(input.concurrency ?? 2)));
  const results: Array<{ segment: DraftMediaSegment; translated: boolean; cost: number; error?: string }> = [];
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      if (input.signal?.aborted) throw new TranslationError("provider-cancelled", "Translation was cancelled.", false);
      const index = nextIndex++;
      const segment = input.segments[index];
      if (!segment) return;
      try {
        const result = await translateWithRetry(input.provider, { text: segment.sourceText, sourceLocale: input.sourceLocale ?? "es-ES", targetLocale: input.targetLocale ?? "zh-CN" }, input.signal);
        results[index] = { segment: { ...segment, translation: result.text.trim() || null }, translated: Boolean(result.text.trim()), cost: result.estimatedCostMicros ?? 0 };
      } catch (error) {
        if (input.signal?.aborted || (error instanceof TranslationError && error.code === "provider-cancelled")) throw error;
        results[index] = { segment: { ...segment, translation: null }, translated: false, cost: 0, error: error instanceof TranslationError ? error.code : "provider-unavailable" };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, input.segments.length) }, () => worker()));
  return {
    segments: results.map((result) => result.segment),
    translatedCount: results.filter((result) => result.translated).length,
    failedCount: results.filter((result) => result.error).length,
    estimatedCostMicros: results.reduce((sum, result) => sum + result.cost, 0),
    errors: results.flatMap((result) => result.error ? [result.error] : []),
  };
}

async function translateWithRetry(provider: TranslationProvider, request: Readonly<{ text: string; sourceLocale: string; targetLocale: string }>, signal?: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await provider.translate(request, { signal });
    } catch (error) {
      lastError = error;
      if (!(error instanceof TranslationError) || !error.retryable || attempt === 2) throw error;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener("abort", abort);
        const timer = setTimeout(() => { cleanup(); resolve(); }, 500 * (attempt + 1));
        const abort = () => { clearTimeout(timer); cleanup(); reject(new TranslationError("provider-cancelled", "Translation was cancelled.", false)); };
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }
  throw lastError instanceof Error ? lastError : new TranslationError("provider-unavailable", "Translation failed.", true);
}
