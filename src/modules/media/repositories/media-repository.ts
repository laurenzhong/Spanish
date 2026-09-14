import type { MediaCard, MediaPlayback, MediaProgress, SaveMediaProgressInput } from "../domain";
import type { ParsedMediaListQuery } from "../schemas";

export type MediaListResult = Readonly<{
  items: readonly MediaCard[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

export type MediaLookupResult =
  | Readonly<{ reason: "found"; media: MediaCard }>
  | Readonly<{ reason: "not_found" | "unavailable"; media: null }>;

export interface MediaRepository {
  list(query: ParsedMediaListQuery, userId?: string): Promise<MediaListResult>;
  findByStableKey(stableKey: string, userId?: string): Promise<MediaLookupResult>;
  getPlayback(stableKey: string, userId: string, now: Date): Promise<MediaPlayback>;
  saveProgress(
    userId: string,
    stableKey: string,
    version: number,
    input: SaveMediaProgressInput,
    now: Date,
  ): Promise<MediaProgress>;
}
