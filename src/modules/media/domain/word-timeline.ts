export type MediaWordTiming = Readonly<{ startMs: number; endMs: number; startOffset: number; endOffset: number }>;

const wordPattern = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?/gu;

/** Offsets refer to exact versioned sourceText (UTF-16); time is absolute media time. */
export function validWordTimings(segment: Readonly<{ sourceText: string; startMs: number; endMs: number; words?: readonly MediaWordTiming[] | null }>): readonly MediaWordTiming[] {
  if (!Array.isArray(segment.words) || !segment.words.length || segment.words.length > 2000) return [];
  let previousTime = segment.startMs;
  let previousOffset = 0;
  const boundaries = new Set(Array.from(segment.sourceText.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?/gu), (match) => `${match.index}:${match.index + match[0].length}`));
  for (const word of segment.words) {
    if (!word || typeof word !== "object" || ![word.startMs, word.endMs, word.startOffset, word.endOffset].every(Number.isInteger)
      || word.startMs < previousTime || word.endMs <= word.startMs || word.endMs > segment.endMs
      || word.startOffset < previousOffset || word.endOffset <= word.startOffset || word.endOffset > segment.sourceText.length
      || !boundaries.has(`${word.startOffset}:${word.endOffset}`)
      || !/[\p{L}\p{M}]/u.test(segment.sourceText.slice(word.startOffset, word.endOffset))) return [];
    previousTime = word.endMs;
    previousOffset = word.endOffset;
  }
  return segment.words;
}

export function activeWordAt(words: readonly MediaWordTiming[], positionMs: number): MediaWordTiming | null {
  return words.find((word) => positionMs >= word.startMs && positionMs < word.endMs) ?? null;
}

/**
 * Provides a deterministic sentence-level fallback when ASR did not return
 * word timestamps. It stays separate from `validWordTimings` so malformed
 * provider data is never treated as verified word timing.
 */
export function estimateWordTimings(segment: Readonly<{ sourceText: string; startMs: number; endMs: number }>): readonly MediaWordTiming[] {
  if (!Number.isInteger(segment.startMs) || !Number.isInteger(segment.endMs) || segment.endMs <= segment.startMs) return [];
  const matches = Array.from(segment.sourceText.matchAll(wordPattern));
  if (matches.length === 0) return [];
  const duration = segment.endMs - segment.startMs;
  return matches.map((match, index) => {
    const startOffset = match.index ?? 0;
    const endOffset = startOffset + match[0].length;
    const startMs = segment.startMs + Math.floor((duration * index) / matches.length);
    const endMs = index === matches.length - 1
      ? segment.endMs
      : segment.startMs + Math.floor((duration * (index + 1)) / matches.length);
    return { startMs, endMs: Math.max(startMs + 1, endMs), startOffset, endOffset };
  });
}

/** Use verified provider timings whenever available, otherwise estimate within the cue. */
export function wordTimingsForPlayback(segment: Readonly<{
  sourceText: string;
  startMs: number;
  endMs: number;
  words?: readonly MediaWordTiming[] | null;
}>): readonly MediaWordTiming[] {
  const verified = validWordTimings(segment);
  return verified.length > 0 ? verified : estimateWordTimings(segment);
}
