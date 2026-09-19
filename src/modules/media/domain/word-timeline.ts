export type MediaWordTiming = Readonly<{ startMs: number; endMs: number; startOffset: number; endOffset: number }>;

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
