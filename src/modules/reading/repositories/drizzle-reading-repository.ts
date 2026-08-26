import { and, asc, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";

import {
  articleId,
  articleReference,
  normalizeSourceUrl,
  type ReadingItem,
  type ReadingState,
  type SavedArticleSource,
} from "../domain/reading-state";
import type { ReadingRepository } from "./reading-repository";

type ReadingDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

function itemRows(
  userId: string,
  articleVersionId: string,
  itemType: "phrase" | "highlight",
  items: readonly ReadingItem[],
) {
  return items.map((item) => ({
    articleVersionId,
    itemType,
    segmentPosition: item.position,
    text: item.text,
    userId,
  }));
}

export function createDrizzleReadingRepository<TResult extends PgQueryResultHKT>(
  database: ReadingDatabase<TResult>,
): ReadingRepository {
  async function findArticleVersion(articleIdValue: string) {
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
      .where(
        and(
          eq(schema.articles.stableKey, reference.stableKey),
          eq(schema.articleVersions.version, reference.version),
          eq(schema.articleVersions.status, "published"),
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
      const version = await findArticleVersion(articleIdValue);
      return version ? projectState(userId, version) : null;
    },

    async upsertState(userId, articleIdValue, patch) {
      const version = await findArticleVersion(articleIdValue);
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
        await transaction
          .delete(schema.userArticleHighlights)
          .where(
            and(
              eq(schema.userArticleHighlights.userId, userId),
              eq(schema.userArticleHighlights.articleVersionId, version.articleVersionId),
            ),
          );
        const rows = [...itemRows(userId, version.articleVersionId, "phrase", patch.savedPhrases), ...itemRows(userId, version.articleVersionId, "highlight", patch.highlights)];
        if (rows.length > 0) {
          await transaction.insert(schema.userArticleHighlights).values(rows).onConflictDoNothing();
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
      const version = await findArticleVersion(articleIdValue);
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
