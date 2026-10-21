/**
 * Resolving one shelf word to a playable piece of audio.
 *
 * The vocabulary shelf can hear most of its words from real speech: an example's
 * segment is a published media segment, and those carry provider word timings.
 * This module owns the decision of *what* to play and, just as importantly, when
 * to give up and let the caller synthesize instead.
 *
 * It is deliberately a pure function over already-loaded data. Loading the
 * example address, the media playback and the audio URL are the caller's job, so
 * the resolution rules — which are the part that can quietly play the wrong
 * sentence — are testable without a database or a network.
 */

import type { MediaPlayback } from "@/src/modules/media/domain/media";
import type { MediaSegmentLookup } from "@/src/modules/media/repositories";

import { findWordClip, type WordClip } from "../domain/word-clip";

/** Where an example's text came from. Articles have no audio path at all. */
export type ExampleAddress = Readonly<{
  word: string;
  /** The example text exactly as the corpus stores it, used to prove the match. */
  exampleText: string;
  documentKind: "media" | "article";
  documentStableKey: string | null;
  documentVersion: number | null;
  /**
   * The source's own segment index (`media_segments.segment_index`, from zero).
   * Stored and compared unconverted: an off-by-one would play the neighbour.
   */
  segmentIndex: number | null;
}>;

/**
 * Why a word has no original audio to play. Every value maps to something a
 * person can be told, so a missing clip is never a silent shrug.
 */
export type WordAudioFallbackReason =
  | "no_example"
  | "article_example"
  | "incomplete_address"
  | "stale_reference"
  | "segment_missing"
  | "word_not_in_segment"
  | "media_unavailable";

export type WordAudioResolution =
  | Readonly<{
    outcome: "clip";
    clip: Readonly<{
      /** Short-lived playback URL for the enclosing media asset. */
      url: string;
      expiresAt: string | null;
      /** Clip window inside the media, in milliseconds. */
      startMs: number;
      stopAtMs: number;
      /** The enclosing segment's own window, so the UI can show the context. */
      segmentStartMs: number;
      segmentEndMs: number;
      segmentIndex: number;
      stableKey: string;
      sourceTitle: string;
      /**
       * The sentence being played, exactly as the served segment has it.
       *
       * It travels with the clip because the audio comes from *our published media*,
       * not from the word: a reader who hears a voice with no matching text on screen
       * cannot tell what was said or why that voice is the right one. Showing the
       * sentence at the moment it sounds is what makes the recording checkable, and it
       * is the segment's own text rather than the word's example field, so what is
       * displayed is what is audible.
       */
      segmentText: string;
    }>;
  }>
  | Readonly<{ outcome: "synthetic"; reason: WordAudioFallbackReason }>;

function synthetic(reason: WordAudioFallbackReason): WordAudioResolution {
  return { outcome: "synthetic", reason };
}

/**
 * The segment a clip can be taken from: only what `findWordClip` reads, plus the window
 * and identity the response reports.
 *
 * Deliberately narrower than `MediaSegment`, so a caller that looked up one segment does
 * not have to fabricate the fields the full transcript carries (translation, speaker,
 * review status) just to satisfy a type. The word window comes from `words` when the
 * provider supplied a timeline, and `words` is absent for older segments.
 */
type ClipSegment = Readonly<{
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  sourceText: string;
  words?: readonly { startMs: number; endMs: number; startOffset: number; endOffset: number; text?: string }[] | null;
}>;

/**
 * The segment the address points at, or `null` when the playback does not contain
 * it.
 *
 * Two steps, in this order, and the second one is what keeps the feature working
 * at all over time:
 *
 * 1. **The stored index**, accepted only when that segment's text is the example
 *    text. This is the exact case and costs one lookup.
 * 2. **The example text itself**, anywhere in the served version.
 *
 * Step 2 exists because media gets re-published: one observed item went from
 * v2 with 146+ segments to v3 with 99, so a stored index of 146 stops resolving
 * entirely and *every* word from that item loses its audio. Matching on the text
 * is not a looser guarantee — the text is the sentence the shelf renders, so
 * playing it can never teach the wrong sentence; if the text is gone or now
 * appears more than once, the caller still gets synthesis rather than a guess.
 */
function findAddressedSegment(
  address: ExampleAddress,
  segments: readonly ClipSegment[],
): ClipSegment | null {
  if (address.segmentIndex !== null) {
    const atIndex = segments.find((candidate) => candidate.index === address.segmentIndex);
    if (atIndex && atIndex.sourceText === address.exampleText) return atIndex;
  }

  const byText = segments.filter((candidate) => candidate.sourceText === address.exampleText);
  // Ambiguous is not a match: two segments with the same text could be two
  // different recordings, and picking the first would be a coin flip.
  return byText.length === 1 ? byText[0]! : null;
}

/**
 * Resolve one word to a clip of real speech, or say why it cannot be done.
 *
 * Two ways in, because the callers want different amounts of the transcript:
 *
 * - `loadLookup` — what a word click uses. The media read returns the playable version's
 *   asset and only the one segment the address names (measured: 1.1 s to load all 108
 *   segments of an item versus a single indexed row).
 * - `loadPlayback` — the full transcript, kept for callers that already have it or need
 *   more than one segment. The rules below are the same either way, so a clip cannot
 *   depend on which entry point was used.
 *
 * Both are thunks because most words never need either: the address alone rules out
 * article examples and incomplete rows, and loading media to then decide "no audio" would
 * cost a read per vocabulary page view.
 */
export async function resolveWordAudioFrom(input: Readonly<{
  address: ExampleAddress | null;
  word: string;
  /** The narrow read: the playable asset plus candidate rows for one segment. */
  loadLookup?: () => Promise<MediaSegmentLookup | null>;
  /** The wide read: the whole transcript. Used when `loadLookup` is not supplied. */
  loadPlayback?: () => Promise<MediaPlayback | null>;
  clipOptions?: Readonly<{ preRollMs?: number; postRollMs?: number; minWordWindowMs?: number }>;
}>): Promise<WordAudioResolution> {
  const { address } = input;
  if (!address) return synthetic("no_example");
  if (address.documentKind !== "media") return synthetic("article_example");
  if (!address.documentStableKey || address.documentVersion === null || address.segmentIndex === null) {
    return synthetic("incomplete_address");
  }

  const clipFor = (segment: ClipSegment, asset: Readonly<{ url: string; expiresAt: string | Date | null }>, sourceTitle: string, stableKey: string): WordAudioResolution => {
    const clip: WordClip | null = findWordClip(segment, input.word, input.clipOptions);
    if (!clip) return synthetic("word_not_in_segment");
    return {
      outcome: "clip" as const,
      clip: {
        url: asset.url,
        expiresAt: asset.expiresAt instanceof Date ? asset.expiresAt.toISOString() : asset.expiresAt,
        startMs: clip.startMs,
        stopAtMs: clip.stopAtMs,
        segmentStartMs: segment.startMs,
        segmentEndMs: segment.endMs,
        segmentIndex: segment.index,
        stableKey,
        sourceTitle,
        // The resolved segment's text, not the stored address's: the text match in
        // `findAddressedSegment` already proved they are equal, and taking it from the
        // segment keeps the displayed sentence and the audible one the same object.
        segmentText: segment.sourceText,
      },
    };
  };

  if (input.loadLookup) {
    const lookup = await input.loadLookup();
    if (!lookup) return synthetic("media_unavailable");
    // The address names an item, and the lookup must be that same item. Its *version*
    // deliberately may differ: a re-publish renumbers segments, and refusing every
    // re-published item would silence every word in it.
    if (lookup.stableKey !== address.documentStableKey) return synthetic("stale_reference");
    const segment = findAddressedSegment(address, lookup.candidates);
    if (!segment) return synthetic("segment_missing");
    return clipFor(segment, lookup.asset, lookup.title, lookup.stableKey);
  }

  const playback = await input.loadPlayback?.();
  if (!playback) return synthetic("media_unavailable");
  if (playback.media.stableKey !== address.documentStableKey) return synthetic("stale_reference");
  const segment = findAddressedSegment(address, playback.segments);
  if (!segment) return synthetic("segment_missing");
  return clipFor(segment, playback.asset, playback.media.title, playback.media.stableKey);
}
