import {
  savedReadingItemsQuerySchema,
  savedShelfQuerySchema,
  type SavedReadingItemsQuery,
  type SavedShelfItem,
  type SavedShelfQuery,
  type SavedShelfResult,
} from "../domain/saved-items";
import type { ReadingRepository } from "../repositories/reading-repository";

/**
 * The public shelf page size is capped at 50 by `savedShelfQuerySchema`. The
 * merged 全部 view reads from two independently paginated tables, so it needs a
 * wider window than one shelf page to keep newest-first ordering exact.
 */
const MERGED_SHELF_WINDOW_MAX = 500;

/**
 * Lists the current user's saved words/phrases and highlights from published
 * article versions. This is a reading projection, not a lexical assessment
 * and therefore has no evidence/profile side effects.
 */
export async function listSavedReadingItems(
  repository: ReadingRepository,
  userId: string,
  input: SavedReadingItemsQuery,
) {
  return repository.listSavedItems(userId, savedReadingItemsQuerySchema.parse(input));
}

function newestFirst(left: SavedShelfItem, right: SavedShelfItem) {
  const delta = right.createdAt.getTime() - left.createdAt.getTime();
  if (delta !== 0) return delta;
  // Stable tiebreaker for identical timestamps: article rows carry no
  // surrogate id, so `articleId`/`id` is the only identity available here.
  return (left.itemType === "article" ? left.articleId : left.id)
    .localeCompare(right.itemType === "article" ? right.articleId : right.id);
}

/**
 * Lists the personal reading shelf (`/read/saved-items`).
 *
 * Pagination semantics:
 * - `itemType=article|phrase|highlight` reads exactly one source and keeps that
 *   source's own `page`/`pageSize`/`total`, so every type tab paginates exactly.
 * - 全部 merges the article source (saved articles plus the user's private AI
 *   stories) with the annotation source by `createdAt` DESC. Because the two
 *   sources are paginated independently in PostgreSQL, the adapter reads the
 *   newest `page * pageSize` rows of each source (capped at
 *   `MERGED_SHELF_WINDOW_MAX`), merges them and slices the requested page.
 *   `total` is the sum of both totals, so the pager reflects the whole shelf;
 *   beyond the window only the newest `MERGED_SHELF_WINDOW_MAX` rows of each
 *   source can appear, while the type tabs stay exact at any depth.
 *
 * This is a reading aid: no evidence event, profile write or provider call
 * happens on any of these paths.
 */
export async function listSavedShelfItems(
  repository: ReadingRepository,
  userId: string,
  input: SavedShelfQuery,
): Promise<SavedShelfResult> {
  const query = savedShelfQuerySchema.parse(input);

  if (query.itemType === "article") {
    const articles = await repository.listSavedArticleShelf(userId, {
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { items: articles.items, page: query.page, pageSize: query.pageSize, total: articles.total };
  }

  if (query.itemType) {
    const annotations = await listSavedReadingItems(repository, userId, {
      search: query.search,
      itemType: query.itemType,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { items: annotations.items, page: query.page, pageSize: query.pageSize, total: annotations.total };
  }

  // 全部: both sources are read from the top so the merged page boundary stays
  // correct. The window read intentionally bypasses the 50-row client page
  // cap; it is an internal projection, not a client page size.
  const windowSize = Math.min(query.page * query.pageSize, MERGED_SHELF_WINDOW_MAX);
  const [articles, annotations] = await Promise.all([
    repository.listSavedArticleShelf(userId, { search: query.search, page: 1, pageSize: windowSize }),
    repository.listSavedItems(userId, { search: query.search, itemType: undefined, page: 1, pageSize: windowSize }),
  ]);
  const merged = [...articles.items, ...annotations.items].sort(newestFirst);
  return {
    items: merged.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: articles.total + annotations.total,
  };
}
