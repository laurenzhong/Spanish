import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQLWrapper } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";

import {
  articleId,
  articleReference,
  normalizeSourceUrl,
  type ReadingState,
  type SavedArticleSource,
} from "../domain/reading-state";
import type {
  SavedArticleItem,
  SavedArticleItemsResult,
  SavedReadingItem,
  SavedReadingItemsQuery,
  SavedReadingItemsResult,
} from "../domain/saved-items";
import type { ReadingRepository, SavedArticleShelfQuery } from "./reading-repository";

type ReadingDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

function readingItemKey(itemType: "phrase" | "highlight", position: number, text: string): string {
  return `${itemType}\u0000${position}\u0000${text}`;
}

function escapedIlike(column: SQLWrapper, pattern: string) {
  // PostgreSQL's default LIKE escape is not guaranteed by the connection
  // settings. Bind it explicitly so '%' and '_' in a private search remain
  // literal characters rather than widening the result set.
  return sql`${column} ILIKE ${pattern} ESCAPE ${"\\"}`;
}

function likePattern(term: string | undefined): string | undefined {
  const trimmed = term?.trim();
  if (!trimmed) return undefined;
  return `%${trimmed.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export function createDrizzleReadingRepository<TResult extends PgQueryResultHKT>(
  database: ReadingDatabase<TResult>,
): ReadingRepository {
  async function findArticleVersion(userId: string, articleIdValue: string) {
    const reference = articleReference(articleIdValue);
    const [row] = await database
      .select({
        articleId: schema.articles.id,
        articleStableKey: schema.articles.stableKey,
        articleVersionId: schema.articleVersions.id,
        contentHash: schema.articleVersions.contentHash,
        version: schema.articleVersions.version,
      })
      .from(schema.articleVersions)
      .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
      .leftJoin(schema.userGeneratedArticles, eq(schema.userGeneratedArticles.articleVersionId, schema.articleVersions.id))
      .where(
        and(
          eq(schema.articles.stableKey, reference.stableKey),
          eq(schema.articleVersions.version, reference.version),
          eq(schema.articleVersions.status, "published"),
          or(isNull(schema.userGeneratedArticles.id), eq(schema.userGeneratedArticles.userId, userId)),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function projectState(
    userId: string,
    version: NonNullable<Awaited<ReturnType<typeof findArticleVersion>>>,
  ): Promise<ReadingState | null> {
    const [progress] = await database
      .select()
      .from(schema.userReadingProgress)
      .where(
        and(
          eq(schema.userReadingProgress.userId, userId),
          eq(schema.userReadingProgress.articleVersionId, version.articleVersionId),
        ),
      )
      .limit(1);
    const save = await database
      .select({ id: schema.userArticleSaves.id })
      .from(schema.userArticleSaves)
      .where(
        and(
          eq(schema.userArticleSaves.userId, userId),
          eq(schema.userArticleSaves.articleVersionId, version.articleVersionId),
        ),
      )
      .limit(1);
    const items = await database
      .select({ itemType: schema.userArticleHighlights.itemType, position: schema.userArticleHighlights.segmentPosition, text: schema.userArticleHighlights.text })
      .from(schema.userArticleHighlights)
      .where(
        and(
          eq(schema.userArticleHighlights.userId, userId),
          eq(schema.userArticleHighlights.articleVersionId, version.articleVersionId),
        ),
      )
      .orderBy(asc(schema.userArticleHighlights.createdAt));
    if (!progress && save.length === 0 && items.length === 0) return null;
    const lastOpenedAt = progress?.lastOpenedAt ?? new Date();
    return {
      articleId: articleId(version.articleStableKey, version.version),
      contentHash: progress?.contentHash ?? version.contentHash,
      highlights: items.filter((item) => item.itemType === "highlight").map(({ position, text }) => ({ position, text })),
      lastOpenedAt,
      note: progress?.note ?? "",
      position: progress?.position ?? 0,
      saved: save.length > 0,
      savedPhrases: items.filter((item) => item.itemType === "phrase").map(({ position, text }) => ({ position, text })),
      status: progress?.status ?? "in_progress",
    };
  }

  return {
    async getState(userId, articleIdValue) {
      const version = await findArticleVersion(userId, articleIdValue);
      return version ? projectState(userId, version) : null;
    },

    async listProgress(userId) {
      const rows = await database
        .select({
          stableKey: schema.articles.stableKey,
          version: schema.articleVersions.version,
          position: schema.userReadingProgress.position,
          status: schema.userReadingProgress.status,
          lastOpenedAt: schema.userReadingProgress.lastOpenedAt,
        })
        .from(schema.userReadingProgress)
        .innerJoin(schema.articleVersions, eq(schema.userReadingProgress.articleVersionId, schema.articleVersions.id))
        .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
        .where(and(eq(schema.userReadingProgress.userId, userId), eq(schema.articleVersions.status, "published")))
        .orderBy(desc(schema.userReadingProgress.lastOpenedAt));
      return rows.map((row) => ({
        articleId: articleId(row.stableKey, row.version),
        lastOpenedAt: row.lastOpenedAt,
        position: row.position,
        status: row.status,
      }));
    },

    async upsertState(userId, articleIdValue, patch) {
      const version = await findArticleVersion(userId, articleIdValue);
      if (!version) throw new Error("ARTICLE_NOT_FOUND");
      if (patch.contentHash !== version.contentHash) throw new Error("ARTICLE_VERSION_CONFLICT");
      await database.transaction(async (transaction) => {
        const now = new Date();
        await transaction
          .insert(schema.userReadingProgress)
          .values({
            articleVersionId: version.articleVersionId,
            contentHash: patch.contentHash,
            lastOpenedAt: now,
            note: patch.note,
            position: patch.position,
            status: patch.status,
            userId,
          })
          .onConflictDoUpdate({
            target: [schema.userReadingProgress.userId, schema.userReadingProgress.articleVersionId],
            set: {
              contentHash: patch.contentHash,
              lastOpenedAt: now,
              note: patch.note,
              position: patch.position,
              status: patch.status,
              updatedAt: now,
            },
          });
        const existingItems = await transaction
          .select({
            id: schema.userArticleHighlights.id,
            itemType: schema.userArticleHighlights.itemType,
            position: schema.userArticleHighlights.segmentPosition,
            text: schema.userArticleHighlights.text,
          })
          .from(schema.userArticleHighlights)
          .where(
            and(
              eq(schema.userArticleHighlights.userId, userId),
              eq(schema.userArticleHighlights.articleVersionId, version.articleVersionId),
            ),
          );
        const desiredItems = [
          ...patch.savedPhrases.map((item) => ({ itemType: "phrase" as const, position: item.position, text: item.text })),
          ...patch.highlights.map((item) => ({ itemType: "highlight" as const, position: item.position, text: item.text })),
        ];
        const desiredKeys = new Set<string>();
        const existingKeys = new Set(existingItems.map((item) => readingItemKey(item.itemType, item.position, item.text)));
        const rowsToInsert = desiredItems.flatMap((item) => {
          const key = readingItemKey(item.itemType, item.position, item.text);
          if (desiredKeys.has(key)) return [];
          desiredKeys.add(key);
          return existingKeys.has(key)
            ? []
            : [{ articleVersionId: version.articleVersionId, itemType: item.itemType, segmentPosition: item.position, text: item.text, userId }];
        });
        const staleIds = existingItems
          .filter((item) => !desiredKeys.has(readingItemKey(item.itemType, item.position, item.text)))
          .map((item) => item.id);
        if (staleIds.length > 0) {
          await transaction
            .delete(schema.userArticleHighlights)
            .where(and(eq(schema.userArticleHighlights.userId, userId), inArray(schema.userArticleHighlights.id, staleIds)));
        }
        if (rowsToInsert.length > 0) {
          await transaction.insert(schema.userArticleHighlights).values(rowsToInsert).onConflictDoNothing();
        }
        if (patch.saved) {
          await transaction
            .insert(schema.userArticleSaves)
            .values({ articleVersionId: version.articleVersionId, userId })
            .onConflictDoNothing();
        } else {
          await transaction
            .delete(schema.userArticleSaves)
            .where(
              and(
                eq(schema.userArticleSaves.userId, userId),
                eq(schema.userArticleSaves.articleVersionId, version.articleVersionId),
              ),
            );
        }
      });
      const state = await projectState(userId, version);
      if (!state) throw new Error("READING_STATE_WRITE_FAILED");
      return state;
    },

    async setSaved(userId, articleIdValue, saved) {
      const version = await findArticleVersion(userId, articleIdValue);
      if (!version) throw new Error("ARTICLE_NOT_FOUND");
      if (saved) {
        const inserted = await database
          .insert(schema.userArticleSaves)
          .values({ articleVersionId: version.articleVersionId, userId })
          .onConflictDoNothing()
          .returning({ id: schema.userArticleSaves.id });
        return inserted.length > 0 || (await projectState(userId, version))?.saved === true;
      }
      await database
        .delete(schema.userArticleSaves)
        .where(
          and(
            eq(schema.userArticleSaves.userId, userId),
            eq(schema.userArticleSaves.articleVersionId, version.articleVersionId),
          ),
        );
      // The API returns the resulting state, not whether a row was deleted.
      return false;
    },

    async listSavedArticleIds(userId) {
      const rows = await database
        .select({ stableKey: schema.articles.stableKey, version: schema.articleVersions.version })
        .from(schema.userArticleSaves)
        .innerJoin(schema.articleVersions, eq(schema.userArticleSaves.articleVersionId, schema.articleVersions.id))
        .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
        .where(eq(schema.userArticleSaves.userId, userId))
        .orderBy(desc(schema.userArticleSaves.createdAt));
      return rows.map((row) => articleId(row.stableKey, row.version));
    },

    async listSavedArticleShelf(userId, query: SavedArticleShelfQuery): Promise<SavedArticleItemsResult> {
      // One query serves both article kinds. Starting from `article_versions`
      // and left-joining the user's save row and the generation row keeps a
      // saved private story as a single row instead of a duplicate, so
      // LIMIT/OFFSET and `total` stay exact for the shelf page.
      const pattern = likePattern(query.search);
      const visibility = and(
        eq(schema.articleVersions.status, "published"),
        eq(schema.articleSources.copyrightStatus, "cleared"),
        // Another user's private story is never part of this shelf, even if a
        // stale save row pointed at it.
        or(isNull(schema.userGeneratedArticles.id), eq(schema.userGeneratedArticles.userId, userId)),
        // Keep the row when the user saved it or generated it.
        or(isNotNull(schema.userArticleSaves.id), eq(schema.userGeneratedArticles.userId, userId)),
        pattern
          ? or(
            escapedIlike(schema.articleVersions.title, pattern),
            escapedIlike(schema.articleVersions.summary, pattern),
            escapedIlike(schema.articleSources.sourceName, pattern),
          )
          : undefined,
      );
      // `createdAt` is the save time when the article is saved and the story
      // creation time otherwise, so both kinds sort on one timeline.
      const shelfTimestamp = sql`coalesce(${schema.userArticleSaves.createdAt}, ${schema.userGeneratedArticles.createdAt})`;
      const [rows, countRows] = await Promise.all([
        database
          .select({
            stableKey: schema.articles.stableKey,
            version: schema.articleVersions.version,
            title: schema.articleVersions.title,
            sourceName: schema.articleSources.sourceName,
            sourceUrl: schema.articleSources.sourceUrl,
            savedAt: schema.userArticleSaves.createdAt,
            generatedAt: schema.userGeneratedArticles.createdAt,
            generatedId: schema.userGeneratedArticles.id,
          })
          .from(schema.articleVersions)
          .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
          .innerJoin(schema.articleSources, eq(schema.articleVersions.sourceId, schema.articleSources.id))
          .leftJoin(schema.userGeneratedArticles, eq(schema.userGeneratedArticles.articleVersionId, schema.articleVersions.id))
          .leftJoin(schema.userArticleSaves, and(
            eq(schema.userArticleSaves.articleVersionId, schema.articleVersions.id),
            eq(schema.userArticleSaves.userId, userId),
          ))
          .where(visibility)
          .orderBy(desc(shelfTimestamp), desc(schema.articleVersions.id))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        database
          .select({ count: sql<number>`count(*)` })
          .from(schema.articleVersions)
          .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
          .innerJoin(schema.articleSources, eq(schema.articleVersions.sourceId, schema.articleSources.id))
          .leftJoin(schema.userGeneratedArticles, eq(schema.userGeneratedArticles.articleVersionId, schema.articleVersions.id))
          .leftJoin(schema.userArticleSaves, and(
            eq(schema.userArticleSaves.articleVersionId, schema.articleVersions.id),
            eq(schema.userArticleSaves.userId, userId),
          ))
          .where(visibility),
      ]);
      const items: readonly SavedArticleItem[] = rows.map((row) => ({
        articleId: articleId(row.stableKey, row.version),
        stableKey: row.stableKey,
        version: row.version,
        title: row.title,
        sourceName: row.sourceName,
        sourceUrl: row.sourceUrl ?? null,
        itemType: "article",
        origin: row.generatedId ? "generated" : "public",
        saved: row.savedAt !== null,
        // Visibility guarantees at least one timestamp; the epoch date is a
        // defensive fallback so the projection can never emit an invalid date.
        createdAt: row.savedAt ?? row.generatedAt ?? new Date(0),
      }));
      return {
        items,
        page: query.page,
        pageSize: query.pageSize,
        total: Number(countRows[0]?.count ?? 0),
      };
    },

    async deleteSavedItem(userId, itemId) {
      const rows = await database
        .delete(schema.userArticleHighlights)
        .where(and(eq(schema.userArticleHighlights.id, itemId), eq(schema.userArticleHighlights.userId, userId)))
        .returning({ id: schema.userArticleHighlights.id });
      return rows.length > 0;
    },

    async listSavedItems(userId, query: SavedReadingItemsQuery): Promise<SavedReadingItemsResult> {
      // The LIKE pattern escapes metacharacters so a user search for "%" or "_"
      // remains a literal search.
      const pattern = likePattern(query.search);
      const searchPredicate = pattern
        ? or(
          escapedIlike(schema.userArticleHighlights.text, pattern),
          escapedIlike(schema.articleVersions.title, pattern),
          escapedIlike(schema.articleSources.sourceName, pattern),
          escapedIlike(schema.articleSegments.sourceText, pattern),
        )
        : undefined;
      const visibility = and(
        eq(schema.userArticleHighlights.userId, userId),
        eq(schema.articleVersions.status, "published"),
        eq(schema.articleSources.copyrightStatus, "cleared"),
        // Generated stories are private article versions. Public rows cannot
        // point at another user's generated version, but keep the ownership
        // check here as a second server-side boundary for service-role reads.
        or(isNull(schema.userGeneratedArticles.id), eq(schema.userGeneratedArticles.userId, userId)),
        query.itemType ? eq(schema.userArticleHighlights.itemType, query.itemType) : undefined,
        searchPredicate,
      );
      const [rows, countRows] = await Promise.all([
        database
          .select({
            id: schema.userArticleHighlights.id,
            itemType: schema.userArticleHighlights.itemType,
            text: schema.userArticleHighlights.text,
            position: schema.userArticleHighlights.segmentPosition,
            createdAt: schema.userArticleHighlights.createdAt,
            stableKey: schema.articles.stableKey,
            version: schema.articleVersions.version,
            title: schema.articleVersions.title,
            sourceName: schema.articleSources.sourceName,
            sourceUrl: schema.articleSources.sourceUrl,
            context: schema.articleSegments.sourceText,
          })
          .from(schema.userArticleHighlights)
          .innerJoin(schema.articleVersions, eq(schema.userArticleHighlights.articleVersionId, schema.articleVersions.id))
          .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
          .innerJoin(schema.articleSources, eq(schema.articleVersions.sourceId, schema.articleSources.id))
          .leftJoin(schema.userGeneratedArticles, eq(schema.userGeneratedArticles.articleVersionId, schema.articleVersions.id))
          .leftJoin(schema.articleSegments, and(
            eq(schema.articleSegments.articleVersionId, schema.articleVersions.id),
            eq(schema.articleSegments.position, schema.userArticleHighlights.segmentPosition),
          ))
          .where(visibility)
          .orderBy(desc(schema.userArticleHighlights.createdAt), desc(schema.userArticleHighlights.id))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        database
          .select({ count: sql<number>`count(*)` })
          .from(schema.userArticleHighlights)
          .innerJoin(schema.articleVersions, eq(schema.userArticleHighlights.articleVersionId, schema.articleVersions.id))
          .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
          .innerJoin(schema.articleSources, eq(schema.articleVersions.sourceId, schema.articleSources.id))
          .leftJoin(schema.userGeneratedArticles, eq(schema.userGeneratedArticles.articleVersionId, schema.articleVersions.id))
          .leftJoin(schema.articleSegments, and(
            eq(schema.articleSegments.articleVersionId, schema.articleVersions.id),
            eq(schema.articleSegments.position, schema.userArticleHighlights.segmentPosition),
          ))
          .where(visibility),
      ]);
      const items: readonly SavedReadingItem[] = rows.map((row) => ({
        id: row.id,
        articleId: articleId(row.stableKey, row.version),
        stableKey: row.stableKey,
        version: row.version,
        title: row.title,
        sourceName: row.sourceName,
        sourceUrl: row.sourceUrl ?? null,
        itemType: row.itemType as SavedReadingItem["itemType"],
        text: row.text,
        position: row.position,
        context: row.context ?? null,
        createdAt: row.createdAt,
      }));
      return {
        items,
        page: query.page,
        pageSize: query.pageSize,
        total: Number(countRows[0]?.count ?? 0),
      };
    },

    async saveSource(userId, input) {
      const normalizedUrl = normalizeSourceUrl(input.url);
      const [row] = await database
        .insert(schema.userSavedArticleSources)
        .values({
          author: input.author ?? null,
          license: input.license ?? null,
          normalizedUrl,
          sourceName: input.sourceName ?? null,
          sourceUrl: input.url,
          title: input.title ?? null,
          userId,
        })
        .onConflictDoUpdate({
          target: [schema.userSavedArticleSources.userId, schema.userSavedArticleSources.normalizedUrl],
          set: {
            author: input.author ?? null,
            license: input.license ?? null,
            sourceName: input.sourceName ?? null,
            sourceUrl: input.url,
            title: input.title ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!row) throw new Error("SOURCE_WRITE_FAILED");
      return row as SavedArticleSource;
    },

    async listSavedSources(userId) {
      const rows = await database
        .select()
        .from(schema.userSavedArticleSources)
        .where(eq(schema.userSavedArticleSources.userId, userId))
        .orderBy(desc(schema.userSavedArticleSources.createdAt));
      return rows as SavedArticleSource[];
    },

    async deleteSavedSource(userId, sourceId) {
      const rows = await database
        .delete(schema.userSavedArticleSources)
        .where(and(eq(schema.userSavedArticleSources.id, sourceId), eq(schema.userSavedArticleSources.userId, userId)))
        .returning({ id: schema.userSavedArticleSources.id });
      return rows.length > 0;
    },
  };
}
