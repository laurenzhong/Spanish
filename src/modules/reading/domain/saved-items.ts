import { z } from "zod";

import { articleId } from "./reading-state";

/**
 * A user-owned item saved from the article reader.
 *
 * Saved items are reading aids only. They are deliberately kept separate from
 * lexical evidence/profile data: opening this list, searching it, or removing
 * an item must never create an evidence event.
 */
export const savedReadingItemTypeSchema = z.enum(["phrase", "highlight"]);
export const savedReadingItemIdSchema = z.string().uuid();

/**
 * The personal shelf (`/read/saved-items`) shows two sources of content:
 * saved articles (including the owner's private AI stories) and the reading
 * annotations stored in `user_article_highlights`. Only `phrase` and
 * `highlight` exist in that table, so the DB-facing annotation query stays
 * narrow while the public shelf query also accepts `article`.
 */
export const savedShelfItemTypeSchema = z.enum(["article", "phrase", "highlight"]);
export type SavedShelfItemType = z.infer<typeof savedShelfItemTypeSchema>;

export const savedReadingItemsQuerySchema = z.object({
  search: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(120).optional(),
  ),
  itemType: savedReadingItemTypeSchema.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});

/** The shelf accepts every item kind the page can render. `?itemType=word` stays a 400. */
export const savedShelfQuerySchema = savedReadingItemsQuerySchema.extend({
  itemType: savedShelfItemTypeSchema.optional(),
});

export type SavedReadingItemType = z.infer<typeof savedReadingItemTypeSchema>;
export type SavedReadingItemsQuery = z.infer<typeof savedReadingItemsQuerySchema>;
export type SavedShelfQuery = z.infer<typeof savedShelfQuerySchema>;

export type SavedReadingItem = Readonly<{
  id: string;
  articleId: string;
  stableKey: string;
  version: number;
  title: string;
  sourceName: string;
  sourceUrl: string | null;
  itemType: SavedReadingItemType;
  text: string;
  position: number;
  context: string | null;
  createdAt: Date;
}>;

export type SavedReadingItemsResult = Readonly<{
  items: readonly SavedReadingItem[];
  page: number;
  pageSize: number;
  total: number;
}>;

/**
 * An article-kind entry on the shelf: either an article the user saved from the
 * reading shelf or one of the user's private AI stories. Private stories are
 * always listed (they are already private to their owner), so `saved` tells the
 * UI whether the entry also carries a `user_article_saves` row.
 */
export const savedArticleOriginSchema = z.enum(["public", "generated"]);
export type SavedArticleOrigin = z.infer<typeof savedArticleOriginSchema>;

export type SavedArticleItem = Readonly<{
  articleId: string;
  stableKey: string;
  version: number;
  title: string;
  sourceName: string;
  sourceUrl: string | null;
  itemType: "article";
  origin: SavedArticleOrigin;
  saved: boolean;
  /** Save time when saved, otherwise the private story creation time. */
  createdAt: Date;
}>;

export type SavedArticleItemsResult = Readonly<{
  items: readonly SavedArticleItem[];
  page: number;
  pageSize: number;
  total: number;
}>;

export type SavedShelfItem = SavedReadingItem | SavedArticleItem;

export type SavedShelfResult = Readonly<{
  items: readonly SavedShelfItem[];
  page: number;
  pageSize: number;
  total: number;
}>;

/** Keep the public DTO free of Date objects at the route boundary. */
export type SavedReadingItemResponse = Omit<SavedReadingItem, "createdAt"> & Readonly<{ createdAt: string }>;
export type SavedArticleItemResponse = Omit<SavedArticleItem, "createdAt"> & Readonly<{ createdAt: string }>;
export type SavedShelfItemResponse = SavedReadingItemResponse | SavedArticleItemResponse;

export function projectSavedReadingItem(item: SavedReadingItem): SavedReadingItemResponse {
  return { ...item, createdAt: item.createdAt.toISOString(), articleId: articleId(item.stableKey, item.version) };
}

export function projectSavedArticleItem(item: SavedArticleItem): SavedArticleItemResponse {
  return { ...item, createdAt: item.createdAt.toISOString(), articleId: articleId(item.stableKey, item.version) };
}

export function projectSavedShelfItem(item: SavedShelfItem): SavedShelfItemResponse {
  return item.itemType === "article" ? projectSavedArticleItem(item) : projectSavedReadingItem(item);
}
