import type {
  ReadingProgressSummary,
  ReadingState,
  ReadingStatePatch,
  SavedArticleSource,
  SavedArticleSourceInput,
} from "../domain/reading-state";

export type ReadingRepository = Readonly<{
  deleteSavedSource(userId: string, sourceId: string): Promise<boolean>;
  getState(userId: string, articleId: string): Promise<ReadingState | null>;
  listProgress(userId: string): Promise<readonly ReadingProgressSummary[]>;
  listSavedArticleIds(userId: string): Promise<readonly string[]>;
  listSavedSources(userId: string): Promise<readonly SavedArticleSource[]>;
  saveSource(userId: string, input: SavedArticleSourceInput): Promise<SavedArticleSource>;
  setSaved(userId: string, articleId: string, saved: boolean): Promise<boolean>;
  upsertState(userId: string, articleId: string, patch: ReadingStatePatch): Promise<ReadingState>;
}>;
