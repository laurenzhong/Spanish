import type {
  ReadingProgressSummary,
  ReadingState,
  ReadingStatePatch,
  SavedArticleSource,
  SavedArticleSourceInput,
} from "../domain/reading-state";
import type { SavedArticleItemsResult, SavedReadingItemsQuery, SavedReadingItemsResult } from "../domain/saved-items";

/** Filters shared by the two shelf sources; `pageSize` stays client-bounded at the route. */
export type SavedArticleShelfQuery = Readonly<{
  search?: string;
  page: number;
  pageSize: number;
}>;

export type ReadingRepository = Readonly<{
  deleteSavedSource(userId: string, sourceId: string): Promise<boolean>;
  deleteSavedItem(userId: string, itemId: string): Promise<boolean>;
  getState(userId: string, articleId: string): Promise<ReadingState | null>;
  listProgress(userId: string): Promise<readonly ReadingProgressSummary[]>;
  listSavedArticleIds(userId: string): Promise<readonly string[]>;
  /**
   * Lists article-kind shelf entries: articles the user saved plus the user's
   * private AI stories. Unlike `listSavedArticleIds` it filters on published
   * status and story ownership and returns the metadata the shelf renders.
   */
  listSavedArticleShelf(userId: string, query: SavedArticleShelfQuery): Promise<SavedArticleItemsResult>;
  listSavedItems(userId: string, query: SavedReadingItemsQuery): Promise<SavedReadingItemsResult>;
  listSavedSources(userId: string): Promise<readonly SavedArticleSource[]>;
  saveSource(userId: string, input: SavedArticleSourceInput): Promise<SavedArticleSource>;
  setSaved(userId: string, articleId: string, saved: boolean): Promise<boolean>;
  upsertState(userId: string, articleId: string, patch: ReadingStatePatch): Promise<ReadingState>;
}>;
