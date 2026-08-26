import {
  readingStatePatchSchema,
  savedArticleSourceInputSchema,
  type ReadingStatePatch,
  type SavedArticleSourceInput,
} from "../domain/reading-state";
import type { ReadingRepository } from "../repositories/reading-repository";

export async function getReadingState(repository: ReadingRepository, userId: string, articleId: string) {
  return repository.getState(userId, articleId.trim().slice(0, 240));
}

export async function saveReadingState(
  repository: ReadingRepository,
  userId: string,
  articleId: string,
  input: ReadingStatePatch,
) {
  return repository.upsertState(userId, articleId.trim().slice(0, 240), readingStatePatchSchema.parse(input));
}

export async function setSavedArticle(repository: ReadingRepository, userId: string, articleId: string, saved: boolean) {
  return repository.setSaved(userId, articleId.trim().slice(0, 240), saved);
}

export async function listSavedArticles(repository: ReadingRepository, userId: string) {
  return repository.listSavedArticleIds(userId);
}

export async function saveExternalSource(repository: ReadingRepository, userId: string, input: SavedArticleSourceInput) {
  return repository.saveSource(userId, savedArticleSourceInputSchema.parse(input));
}

export async function listExternalSources(repository: ReadingRepository, userId: string) {
  return repository.listSavedSources(userId);
}

export async function deleteExternalSource(repository: ReadingRepository, userId: string, sourceId: string) {
  return repository.deleteSavedSource(userId, sourceId);
}
