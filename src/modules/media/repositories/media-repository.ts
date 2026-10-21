import type { MediaCard, MediaPlayback, MediaPlaybackOverview, MediaProgress, MediaStreamSource, SaveMediaProgressInput } from "../domain";
import type { MediaBrowseQuery, ParsedMediaListQuery } from "../schemas";

export type MediaListResult = Readonly<{
  items: readonly MediaCard[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

export type MediaLookupResult =
  | Readonly<{ reason: "found"; media: MediaCard }>
  | Readonly<{ reason: "not_found" | "unavailable"; media: null }>;

/**
 * What a caller that needs one segment of a media item actually has to read.
 *
 * `getPlayback` returns the complete approved transcript,
 * including each segment's word-level timings — because the player needs all of it. A
 * caller resolving a single word does not: it needs the playable version's asset and one
 * sentence. Measured against a 108-segment item, loading the whole playback took 1.1 s
 * per click, and this read exists to make that cost proportionate to the question.
 */
export type MediaSegmentLookup = Readonly<{
  stableKey: string;
  title: string;
  version: number;
  asset: Readonly<{ kind: string; url: string; expiresAt: Date | null }>;
  /**
   * Narrow candidate rows for the segment being looked for.
   *
   * More than one row with the same text must be treated as no match rather than as a
   * coin flip, which is why the whole candidate set is returned rather than one row.
   */
  candidates: readonly Readonly<{ id: string; index: number; startMs: number; endMs: number; sourceText: string }>[];
}>;

export interface MediaRepository {
  browse(query: MediaBrowseQuery, userId: string): Promise<MediaListResult>;
  list(query: ParsedMediaListQuery, userId?: string): Promise<MediaListResult>;
  findByStableKey(stableKey: string, userId?: string): Promise<MediaLookupResult>;
  /**
   * The complete playback projection.
   *
   * `includeWords: false` keeps the card, asset and every approved sentence but
   * returns `words: null` and never reads the word-timing JSON, which is 68–89%
   * of a large transcript's bytes. That is the first phase of the detail page;
   * the default keeps the existing full contract for `/playback`.
   */
  getPlayback(stableKey: string, userId: string, now: Date, options?: Readonly<{ includeWords?: boolean }>): Promise<MediaPlayback>;
  /**
   * The title/player half of `getPlayback`, without reading the transcript.
   *
   * Reuses the same version/publication/rights/expiry gates and the same card
   * projection, but only counts the approved cues of the playable version so
   * the detail page can render before the (much larger) transcript is loaded.
   */
  getPlaybackOverview(stableKey: string, userId: string, now: Date): Promise<MediaPlaybackOverview>;
  /** Recheck playback gates without reading the transcript or any user's progress. */
  getStreamSource(stableKey: string, now: Date): Promise<MediaStreamSource>;
  /**
   * The playable version's asset, plus the narrow rows that could be the wanted segment.
   *
   * `segmentIndex` is the stored address; `expectedText` is the sentence the address was
   * stored with. Both are consulted because media gets re-published and renumbering moves
   * segments: the index is the exact case, and the text is what still finds the sentence
   * afterwards. Reads the segment table with only the columns a clip needs.
   */
  getSegmentLookup(
    stableKey: string,
    lookFor: Readonly<{ segmentIndex: number | null; expectedText: string }>,
    now: Date,
  ): Promise<MediaSegmentLookup | null>;
  saveProgress(
    userId: string,
    stableKey: string,
    version: number,
    input: SaveMediaProgressInput,
    now: Date,
  ): Promise<MediaProgress>;
}
