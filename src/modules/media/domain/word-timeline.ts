export type MediaWordTiming = Readonly<{
  startMs: number;
  endMs: number;
  startOffset: number;
  endOffset: number;
  /** Provider lexical token, when available. Older published rows omit it. */
  text?: string;
}>;

/** Spoken tokens include numbers and clock/date-like forms such as `24`, `3`, and `2:33`. */
// Keep decimal comma tokens (for example `1,6`) intact because providers
// report them as one spoken token and the immutable source text uses the same
// spelling. Other date/time separators remain supported as before.
export const mediaWordTokenPatternSource = String.raw`[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)?(?:[/:.,-][\p{N}]+)*`;

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
  // Older published rows intentionally store only offsets.  The offsets have
  // already been checked against the immutable sourceText above, so the
  // source slice is the authoritative lexical label for playback.  When a
  // provider supplies `text`, validWordTimings still rejects any mismatch.
  if (verified.length > 0) return verified;
  // Never replace a non-empty provider timeline with guessed positions. A
  // malformed timeline must fail closed; estimating it would highlight words
  // that may not be spoken at that time. Cues with no provider word data also
  // fail closed; the transcript remains readable and words remain selectable,
  // but no automatic speaking box is shown until an exact timeline exists.
  return [];
}

/** One provider-reported word (or punctuation mark) with absolute media time. */
export type MediaProviderWordUnit = Readonly<{
  startMs: number;
  endMs: number;
  text: string;
}>;

/**
 * A sentence-level transcript cue built only from provider word timestamps.
 * `words` always indexes exact UTF-16 slices of `sourceText`.
 */
export type MediaTranscriptSentence = Readonly<{
  startMs: number;
  endMs: number;
  sourceText: string;
  words: readonly MediaWordTiming[];
}>;

export const mediaSentenceMaxLength = 240;
export const mediaSentenceMaxGapMs = 1_000;

export type MediaSentenceGroupingOptions = Readonly<{
  /** Candidate media duration; provider timestamps after it are rejected. */
  durationMs?: number;
  maxSentenceLength?: number;
  maxGapMs?: number;
}>;

export class MediaWordTimelineError extends Error {
  readonly code = "MEDIA_WORD_TIMELINE_INVALID" as const;

  constructor(message: string) {
    super(`MEDIA_WORD_TIMELINE_INVALID: ${message}`);
    this.name = "MediaWordTimelineError";
  }
}

// Terminal punctuation can be followed by closing quotes/brackets that belong
// to the same sentence, for example `«Hola.»`.
const sentenceTerminalPattern = /[.!?。！？…]["'»”’)\]}]*$/u;
// Characters that close a phrase must not receive a preceding space.
const closingLeadingPattern = /^[.,;:!?…%)\]}»”’"']/u;
// Characters that open a phrase must not receive a following space.
const openingTrailingPattern = /[¿¡([{«“‘"']$/u;
const closingPunctuationOnlyPattern = /^[.,;:!?…%)\]}»”’"']+$/u;

function separatorBefore(text: string, next: string): string {
  if (!text) return "";
  if (closingLeadingPattern.test(next)) return "";
  if (openingTrailingPattern.test(text)) return "";
  return " ";
}

function validateGroupedSentence(candidate: MediaTranscriptSentence): MediaTranscriptSentence {
  const validated = validWordTimings(candidate);
  if (validated.length === 0 || validated.length !== candidate.words.length) {
    throw new MediaWordTimelineError("Grouped provider words do not match their sentence text offsets.");
  }
  const exact: MediaTranscriptSentence = { ...candidate, words: validated };
  if (!hasExactWordLexemes(exact)) {
    throw new MediaWordTimelineError("Grouped provider words are missing their exact lexical text.");
  }
  return exact;
}

/**
 * Splits provider word timestamps into sentence cues without estimating any
 * position. Every returned word is an exact UTF-16 slice of `sourceText` and
 * inherits the provider's start/end milliseconds. The function fails closed
 * when the provider did not return word-level units: publishing a guessed
 * timeline is never acceptable for automatic word-selection evidence.
 */
export function groupProviderWordsIntoSentences(
  units: readonly MediaProviderWordUnit[],
  options: MediaSentenceGroupingOptions = {},
): MediaTranscriptSentence[] {
  const maxSentenceLength = options.maxSentenceLength ?? mediaSentenceMaxLength;
  const maxGapMs = options.maxGapMs ?? mediaSentenceMaxGapMs;
  if (!Number.isSafeInteger(maxSentenceLength) || maxSentenceLength <= 0) throw new MediaWordTimelineError("maxSentenceLength must be a positive safe integer.");
  if (!Number.isSafeInteger(maxGapMs) || maxGapMs < 0) throw new MediaWordTimelineError("maxGapMs must be a non-negative safe integer.");
  if (options.durationMs !== undefined && (!Number.isSafeInteger(options.durationMs) || options.durationMs <= 0)) {
    throw new MediaWordTimelineError("durationMs must be a positive safe integer.");
  }
  if (units.length === 0) return [];

  const normalized: Array<Readonly<{ startMs: number; endMs: number; text: string; token: string | null }>> = [];
  let previousEnd: number | null = null;
  for (const unit of units) {
    if (!unit || typeof unit.text !== "string") throw new MediaWordTimelineError("A provider timing unit is malformed.");
    const text = unit.text.trim();
    if (!text) throw new MediaWordTimelineError("A provider timing unit contains no text.");
    if (!Number.isInteger(unit.startMs) || !Number.isInteger(unit.endMs) || unit.startMs < 0 || unit.endMs <= unit.startMs) {
      throw new MediaWordTimelineError("Provider word timestamps must be integers with a positive duration.");
    }
    if (previousEnd !== null && unit.startMs < previousEnd) {
      throw new MediaWordTimelineError("Provider word timestamps overlap or are not monotonic.");
    }
    if (options.durationMs !== undefined && unit.endMs > options.durationMs) {
      throw new MediaWordTimelineError("A provider word timestamp ends after the media duration.");
    }
    const matches = mediaWordMatches(text);
    if (matches.length > 1) {
      throw new MediaWordTimelineError(`Provider timestamps are not word-level: "${text}" contains multiple lexical tokens.`);
    }
    previousEnd = unit.endMs;
    normalized.push({ startMs: unit.startMs, endMs: unit.endMs, text, token: matches[0]?.[0] ?? null });
  }

  const sentences: MediaTranscriptSentence[] = [];
  let current: { startMs: number; endMs: number; text: string; words: MediaWordTiming[]; terminal: boolean } | null = null;
  const flush = () => {
    if (!current || current.words.length === 0) {
      current = null;
      return;
    }
    sentences.push(validateGroupedSentence({ startMs: current.startMs, endMs: current.endMs, sourceText: current.text, words: current.words }));
    current = null;
  };

  for (const unit of normalized) {
    // A finished sentence may still receive its closing quote/bracket units.
    if (current?.terminal) {
      if (!closingPunctuationOnlyPattern.test(unit.text)) flush();
    }
    if (current && current.words.length > 0 && unit.startMs - current.endMs > maxGapMs) flush();
    if (!current) {
      current = { startMs: unit.startMs, endMs: unit.endMs, text: "", words: [], terminal: false };
    }
    const separator = separatorBefore(current.text, unit.text);
    const unitStart = current.text.length + separator.length;
    current.text += separator + unit.text;
    current.endMs = unit.endMs;
    if (unit.token !== null) {
      const match = mediaWordMatches(unit.text)[0]!;
      const localStart = match.index ?? 0;
      const startOffset = unitStart + localStart;
      const endOffset = startOffset + match[0].length;
      current.words.push({ startMs: unit.startMs, endMs: unit.endMs, startOffset, endOffset, text: unit.text.slice(localStart, localStart + match[0].length) });
    }
    if (current.words.length > 0) {
      if (sentenceTerminalPattern.test(current.text)) current.terminal = true;
      if (current.text.length >= maxSentenceLength) flush();
    }
  }
  flush();
  return sentences;
}

