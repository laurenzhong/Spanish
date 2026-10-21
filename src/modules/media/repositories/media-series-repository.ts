import type { MediaCard } from "../domain/media";
import type { MediaSeriesDescriptor, SaveMediaSeriesCommand } from "../domain/media-series";
import type { MediaSeriesEpisodesQuery } from "../schemas/media-series";

export type MediaSeriesView = MediaSeriesDescriptor & Readonly<{ episodeCount: number }>;
export type MediaSeriesEpisodes = Readonly<{
  series: MediaSeriesView;
  items: readonly MediaCard[];
  anchor: Readonly<{ current: MediaCard | null; previous: MediaCard | null; next: MediaCard | null }>;
  nextCursor: string | null;
  hasMore: boolean;
}>;
export type MediaSeriesRecommendations = Readonly<{ series: MediaSeriesView | null; items: readonly MediaCard[] }>;
export interface MediaSeriesRepository {
  getSeries(seriesKey: string, userId: string): Promise<MediaSeriesView>;
  listEpisodes(seriesKey: string, query: MediaSeriesEpisodesQuery, userId: string): Promise<MediaSeriesEpisodes>;
  recommendations(stableKey: string, userId: string): Promise<MediaSeriesRecommendations>;
  save(seriesKey: string, command: SaveMediaSeriesCommand, ownerUserId: string): Promise<MediaSeriesDescriptor>;
}
