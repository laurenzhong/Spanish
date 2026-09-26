export type MediaWordTiming = Readonly<{
  startMs: number;
  endMs: number;
  startOffset: number;
  endOffset: number;
  /** Provider lexical token, when available. Older published rows omit it. */
  text?: string;
}>;

/** Spoken tokens include numbers and clock/date-like forms such as `24`, `3`, and `2:33`. */
export const mediaWordTokenPatternSource = String.raw`[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)?(?:[/:.-][\p{N}]+)*`;

export function mediaWordMatches(text: string): readonly RegExpMatchArray[] {
  return Array.from(text.matchAll(new RegExp(mediaWordTokenPatternSource, "gu")));
}

/** Offsets refer to exact versioned sourceText (UTF-16); time is absolute media time. */
export function validWordTimings(segment: Readonly<{ sourceText: string; startMs: number; endMs: number; words?: readonly MediaWordTiming[] | null }>): readonly MediaWordTiming[] {
  if (!Array.isArray(segment.words) || !segment.words.length || segment.words.length > 2000) return [];
  let previousTime = segment.startMs;
  let previousOffset = 0;
  const boundaries = mediaWordMatches(segment.sourceText).map((match) => {
    const start = match.index ?? 0;
    return `${start}:${start + match[0].length}`;
  });
  if (segment.words.length !== boundaries.length) return [];
  for (const [index, word] of segment.words.entries()) {
    if (!word || typeof word !== "object" || ![word.startMs, word.endMs, word.startOffset, word.endOffset].every(Number.isInteger)
      || word.startMs < previousTime || word.endMs <= word.startMs || word.endMs > segment.endMs
      || word.startOffset < previousOffset || word.endOffset <= word.startOffset || word.endOffset > segment.sourceText.length
      || boundaries[index] !== `${word.startOffset}:${word.endOffset}`
      || !/[\p{L}\p{M}\p{N}]/u.test(segment.sourceText.slice(word.startOffset, word.endOffset))
      || (word.text !== undefined && (typeof word.text !== "string" || word.text !== segment.sourceText.slice(word.startOffset, word.endOffset)))) return [];
    previousTime = word.endMs;
    previousOffset = word.endOffset;
  }
  return segment.words;
}

/**
 * A valid offset timeline is still not enough for automatic publication: the
 * provider must identify the exact lexical token represented by each timing.
 * This prevents a provider response with plausible offsets but missing or
 * mismatched word text from being presented as spoken-word evidence.
 */
export function hasExactWordLexemes(segment: Readonly<{ sourceText: string; startMs: number; endMs: number; words?: readonly MediaWordTiming[] | null }>): boolean {
  const words = validWordTimings(segment);
  return words.length > 0 && words.every((word) => typeof word.text === "string" && word.text === segment.sourceText.slice(word.startOffset, word.endOffset));
}

export function activeWordAt(words: readonly MediaWordTiming[], positionMs: number): MediaWordTiming | null {
  return words.find((word) => positionMs >= word.startMs && positionMs < word.endMs) ?? null;
}

/**
 * Kept as a utility for authoring and diagnostics only. Playback must never
 * use these estimates: a guessed word window can select a word that was not
 * spoken at that instant.
 */
export function estimateWordTimings(segment: Readonly<{ sourceText: string; startMs: number; endMs: number }>): readonly MediaWordTiming[] {
  if (!Number.isInteger(segment.startMs) || !Number.isInteger(segment.endMs) || segment.endMs <= segment.startMs) return [];
  const matches = mediaWordMatches(segment.sourceText);
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

/** Use only provider timings that include an exact lexical match in sourceText. */
export function wordTimingsForPlayback(segment: Readonly<{
  sourceText: string;
  startMs: number;
  endMs: number;
  words?: readonly MediaWordTiming[] | null;
}>): readonly MediaWordTiming[] {
  const verified = validWordTimings(segment);
  if (verified.length > 0 && hasExactWordLexemes(segment)) return verified;
  // Never replace a non-empty provider timeline with guessed positions. A
  // malformed timeline must fail closed; estimating it would highlight words
  // that may not be spoken at that time. Cues with no provider word data also
  // fail closed; the transcript remains readable and words remain selectable,
  // but no automatic speaking box is shown until an exact timeline exists.
  return [];
}
