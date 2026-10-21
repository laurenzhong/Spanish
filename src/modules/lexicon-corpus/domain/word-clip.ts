import { wordTimingsForPlayback, type MediaWordTiming } from "@/src/modules/media/domain/word-timeline";

import { normalizeSpanishSurface } from "./spanish-token";

/** Lead-in kept before the matched word so its first phoneme is audible. */
export const DEFAULT_PRE_ROLL_MS = 120;
/** Tail kept after the matched word so its last phoneme is not cut off. */
export const DEFAULT_POST_ROLL_MS = 250;
/**
 * A provider window narrower than this is too coarse to be a full word
 * pronunciation, so playback degrades to the enclosing segment instead of
 * clipping a syllable.
 */
export const MIN_WORD_WINDOW_MS = 60;

export type WordClip = Readonly<{ startMs: number; stopAtMs: number }>;

/**
 * Milliseconds options only make sense as finite, non-negative values. A
 * malformed roll would silently move the clip over a neighbouring word, so the
 * caller gets `null` and falls back to synthesized speech.
 */
function resolveDurationOption(value: number | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function tokenSurface(
  segment: Readonly<{ sourceText: string }>,
  timing: MediaWordTiming,
): string {
  // Older published segments store offsets only. The timeline validator has
  // already proven those offsets slice real tokens out of sourceText, so the
  // slice is the authoritative label whenever `text` is absent.
  return typeof timing.text === "string"
    ? timing.text
    : segment.sourceText.slice(timing.startOffset, timing.endOffset);
}

function windowsIntersect(left: MediaWordTiming, right: MediaWordTiming): boolean {
  // Word windows are closed intervals. A provider that ends one repeated token
  // exactly where the next one begins is still describing one continuous
  // pronunciation, and a validated timeline cannot overlap any deeper.
  return left.startMs <= right.endMs && right.startMs <= left.endMs;
}

function allWindowsIntersect(windows: readonly MediaWordTiming[]): boolean {
  return windows.every((left, leftIndex) => windows.every(
    (right, rightIndex) => leftIndex >= rightIndex || windowsIntersect(left, right),
  ));
}

function earliestWindow(windows: readonly MediaWordTiming[]): MediaWordTiming {
  return windows.reduce((earliest, candidate) => (candidate.startMs < earliest.startMs ? candidate : earliest));
}

/**
 * Locates one shelf word inside a media segment and returns the playback
 * window, or `null` when that audio cannot be identified with certainty.
 *
 * The function is deliberately fail-closed: the caller falls back to
 * synthesized speech, and hearing a synthesized word is harmless, while
 * playing the wrong slice of real speech teaches the wrong pronunciation.
 */
export function findWordClip(
  segment: Readonly<{ sourceText: string; startMs: number; endMs: number; words?: readonly MediaWordTiming[] | null }>,
  word: string,
  options?: Readonly<{ preRollMs?: number; postRollMs?: number; minWordWindowMs?: number }>,
): WordClip | null {
  const preRollMs = resolveDurationOption(options?.preRollMs, DEFAULT_PRE_ROLL_MS);
  const postRollMs = resolveDurationOption(options?.postRollMs, DEFAULT_POST_ROLL_MS);
  const minWordWindowMs = resolveDurationOption(options?.minWordWindowMs, MIN_WORD_WINDOW_MS);
  if (preRollMs === null || postRollMs === null || minWordWindowMs === null) return null;

  // A segment without forward time cannot yield a playable window.
  if (!(segment.startMs < segment.endMs)) return null;

  const target = normalizeSpanishSurface(word);
  // Token surfaces always carry at least one letter or digit, so an empty
  // target could only ever match a degenerate token: that is a guess.
  if (!target) return null;

  // Only verified provider timings count. wordTimingsForPlayback() already
  // returns an empty timeline for missing or inconsistent data, and
  // estimateWordTimings() must never be used here: a guessed window can select
  // a word that was not spoken at that instant.
  const timings = wordTimingsForPlayback(segment);
  if (timings.length === 0) return null;

  // Equality is checked on the whole token. A substring hit (`sol` inside
  // `solo`) is a different word, so its window would play the wrong audio.
  const hits = timings.filter((timing) => normalizeSpanishSurface(tokenSurface(segment, timing)) === target);
  if (hits.length === 0) return null;

  // A repeated surface is either one pronunciation event or genuinely several.
  // Overlapping windows are one continuous pronunciation, so the earliest is
  // safe; disjoint windows are ambiguous and must fall back to synthesis
  // rather than guess which occurrence the shelf word meant.
  if (hits.length > 1 && !allWindowsIntersect(hits)) return null;
  const hit = earliestWindow(hits);

  // Provider data that cannot resolve a whole word is coarse, not evidence:
  // the enclosing segment is honest about that uncertainty and still contains
  // the requested word.
  if (hit.endMs - hit.startMs < minWordWindowMs) {
    return { startMs: segment.startMs, stopAtMs: segment.endMs };
  }

  const startMs = Math.max(hit.startMs - preRollMs, segment.startMs);
  const stopAtMs = Math.min(hit.endMs + postRollMs, segment.endMs);
  // Defense in depth: an empty or inverted window must never reach the player.
  if (!(startMs < stopAtMs)) return null;

  return { startMs, stopAtMs };
}
