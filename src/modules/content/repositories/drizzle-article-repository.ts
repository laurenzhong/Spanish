import { and, desc, eq, max } from "drizzle-orm";

import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

import {
  filterArticles,
  parseArticleId,
  projectArticleReader,
  projectPublicArticle,
  type ArticleCardProjection,
  type ArticleListQuery,
} from "../domain/article";
import type { AcquiredArticleRepository } from "./acquired-article-repository";
import type { ArticleRepository } from "./article-repository";

export class AcquiredArticlePersistenceConflictError extends Error {
  readonly code = "CONTENT_PUBLICATION_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "AcquiredArticlePersistenceConflictError";
  }
}

type ArticleJoinRow = Readonly<{
  article: typeof schema.articles.$inferSelect;
  version: typeof schema.articleVersions.$inferSelect;
  source: typeof schema.articleSources.$inferSelect;
}>;

function rawArticle(
  row: ArticleJoinRow,
  segments: readonly { position: number; sourceText: string }[] = [],
  assets: readonly typeof schema.articleAssets.$inferSelect[] = [],
) {
  return {
    stableKey: row.article.stableKey,
    version: row.version.version,
    locale: row.version.locale,
    title: row.version.title,
    summary: row.version.summary,
    source: {
      sourceName: row.source.sourceName,
      author: row.source.author ?? undefined,
      publicationDate: row.source.publicationDate ?? undefined,
      copyrightStatus: row.source.copyrightStatus as "unverified" | "cleared" | "restricted",
      sourceUrl: row.source.sourceUrl ?? undefined,
      attribution: row.source.attribution ?? undefined,
    },
    cefr: row.version.cefrLevel as ArticleCardProjection["cefr"],
    topics: row.version.topics,
    region: row.version.region,
    register: row.version.register,
    format: row.version.format as ArticleCardProjection["format"],
    estimatedReadingMinutes: row.version.estimatedReadingMinutes,
    assets: assets.map((asset) => ({
      assetType: asset.assetType as "audio" | "chinese_summary" | "word_help" | "image",
      available: asset.available,
    })),
    oralTransferType: row.version.oralTransferType as ArticleCardProjection["oralTransferType"],
    status: row.version.status as "draft" | "review" | "approved" | "published" | "archived",
    contentHash: row.version.contentHash,
    segments: segments.map((segment) => ({ position: segment.position, text: segment.sourceText })),
  };
}

export type DrizzleArticleRepository = ArticleRepository & AcquiredArticleRepository;

export function createDrizzleArticleRepository(database: Database): DrizzleArticleRepository {
  return {
    async publishAcquired(input) {
      if (input.contentHash !== input.draft.contentHash) {
        throw new AcquiredArticlePersistenceConflictError("The candidate hash does not match the immutable article draft.");
      }
      return database.transaction(async (transaction) => {
        const [existing] = await transaction
          .select({
            article: schema.articles,
            version: schema.articleVersions,
            source: schema.articleSources,
          })
          .from(schema.articleSources)
          .innerJoin(schema.articleVersions, eq(schema.articleVersions.sourceId, schema.articleSources.id))
          .innerJoin(schema.articles, eq(schema.articles.id, schema.articleVersions.articleId))
          .where(and(
            eq(schema.articleSources.acquisitionCandidateId, input.candidateId),
            eq(schema.articleSources.acquisitionCandidateRevision, input.candidateRevision),
          ))
          .limit(1);
        if (existing) {
          if (
            existing.article.stableKey !== input.draft.stableKey
            || existing.version.contentHash !== input.contentHash
            || existing.source.sourceUrl !== input.draft.canonicalUrl
          ) {
            throw new AcquiredArticlePersistenceConflictError("The candidate revision already published different immutable content.");
          }
          return { kind: "article" as const, stableKey: existing.article.stableKey, version: existing.version.version };
        }

        await transaction.insert(schema.articles).values({ stableKey: input.draft.stableKey }).onConflictDoNothing({
          target: schema.articles.stableKey,
        });
        const [article] = await transaction
          .select()
          .from(schema.articles)
          .where(eq(schema.articles.stableKey, input.draft.stableKey))
          .limit(1)
          .for("update");
        if (!article) throw new AcquiredArticlePersistenceConflictError("The article identity could not be claimed.");

        const [latest] = await transaction
          .select({ value: max(schema.articleVersions.version) })
          .from(schema.articleVersions)
          .where(eq(schema.articleVersions.articleId, article.id));
        const versionNumber = Number(latest?.value ?? 0) + 1;
        const [source] = await transaction.insert(schema.articleSources).values({
          sourceType: input.draft.sourceType,
          sourceName: input.draft.sourceName,
          author: input.draft.author,
          sourceUrl: input.draft.canonicalUrl,
          publicationDate: input.draft.publicationDate,
          license: input.draft.license,
          attribution: input.draft.attribution,
          licenseEvidence: input.draft.licenseEvidence,
          copyrightStatus: input.draft.copyrightStatus,
          reviewNotes: "Rights and attribution were approved in the owner content workflow.",
          acquisitionCandidateId: input.candidateId,
          acquisitionCandidateRevision: input.candidateRevision,
          fetchedAt: new Date(input.draft.fetchedAt),
        }).returning({ id: schema.articleSources.id });
        if (!source) throw new Error("ARTICLE_SOURCE_WRITE_FAILED");
        const [version] = await transaction.insert(schema.articleVersions).values({
          articleId: article.id,
          sourceId: source.id,
          version: versionNumber,
          locale: input.draft.locale,
          title: input.draft.title,
          summary: input.draft.summary,
          curatedAt: input.publishedAt,
          contentHash: input.contentHash,
          cefrLevel: input.draft.cefr,
          topics: [...input.draft.topics],
          region: input.draft.region,
          register: input.draft.register,
          format: input.draft.format,
          estimatedReadingMinutes: input.draft.estimatedReadingMinutes,
          assets: [],
          relatedExpressionKeys: [],
          relatedGoalKeys: [],
          relatedTagKeys: [],
          oralTransferType: input.draft.oralTransferType,
          status: "published",
          publishedAt: input.publishedAt,
          changeReason: input.draft.changeReason,
          reviewNotes: "Published from a versioned acquisition candidate after independent es-ES and zh-CN review.",
        }).returning({ id: schema.articleVersions.id });
        if (!version) throw new Error("ARTICLE_VERSION_WRITE_FAILED");
        await transaction.insert(schema.articleSegments).values(
          input.draft.paragraphs.map((sourceText, position) => ({ articleVersionId: version.id, position, sourceText })),
        );
        await transaction.insert(schema.contentReviews).values(input.reviews.map((review) => ({
          entityType: "article",
          entityId: version.id,
          locale: review.locale,
          status: "approved" as const,
          reviewerReference: review.reviewerReference,
          notes: review.notes,
          reviewedAt: review.reviewedAt,
        })));
        return { kind: "article" as const, stableKey: article.stableKey, version: versionNumber };
      });
    },

    async archiveAcquired(input) {
      await database.transaction(async (transaction) => {
        const [row] = await transaction
          .select({
            versionId: schema.articleVersions.id,
            status: schema.articleVersions.status,
          })
          .from(schema.articleVersions)
          .innerJoin(schema.articles, eq(schema.articles.id, schema.articleVersions.articleId))
          .innerJoin(schema.articleSources, eq(schema.articleSources.id, schema.articleVersions.sourceId))
          .where(and(
            eq(schema.articles.stableKey, input.publication.stableKey),
            eq(schema.articleVersions.version, input.publication.version),
            eq(schema.articleSources.acquisitionCandidateId, input.candidateId),
          ))
          .limit(1)
          .for("update");
        if (!row) throw new AcquiredArticlePersistenceConflictError("The article publication does not belong to this candidate.");
        if (row.status === "archived") return;
        if (row.status !== "published") throw new AcquiredArticlePersistenceConflictError("Only a published article can be archived.");
        const updated = await transaction
          .update(schema.articleVersions)
          .set({ status: "archived", updatedAt: input.archivedAt })
          .where(and(eq(schema.articleVersions.id, row.versionId), eq(schema.articleVersions.status, "published")))
          .returning({ id: schema.articleVersions.id });
        if (updated.length !== 1) throw new AcquiredArticlePersistenceConflictError("The article changed before archival.");
      });
    },

    async list(query: ArticleListQuery = {}) {
      const rows = await database
        .select({ article: schema.articles, version: schema.articleVersions, source: schema.articleSources })
        .from(schema.articleVersions)
        .innerJoin(schema.articles, eq(schema.articles.id, schema.articleVersions.articleId))
        .innerJoin(schema.articleSources, eq(schema.articleSources.id, schema.articleVersions.sourceId))
        .where(and(eq(schema.articleVersions.status, "published"), eq(schema.articleSources.copyrightStatus, "cleared")))
        .orderBy(desc(schema.articleVersions.publishedAt));
      const projected = rows.map((row) => projectPublicArticle(rawArticle(row))).filter((article): article is ArticleCardProjection => article !== null);
      return filterArticles(projected, query);
    },

    async findById(id) {
      const parsed = parseArticleId(id);
      if (!parsed) return { article: null, reason: "not-found" as const };
      const [row] = await database
        .select({ article: schema.articles, version: schema.articleVersions, source: schema.articleSources })
        .from(schema.articleVersions)
        .innerJoin(schema.articles, eq(schema.articles.id, schema.articleVersions.articleId))
        .innerJoin(schema.articleSources, eq(schema.articleSources.id, schema.articleVersions.sourceId))
        .where(and(eq(schema.articles.stableKey, parsed.stableKey), eq(schema.articleVersions.version, parsed.version)))
        .limit(1);
      if (!row) return { article: null, reason: "not-found" as const };
      if (row.version.status !== "published" || row.source.copyrightStatus !== "cleared") {
        return { article: null, reason: "unpublished" as const };
      }
      const [segments, assets] = await Promise.all([
        database.select({ position: schema.articleSegments.position, sourceText: schema.articleSegments.sourceText })
          .from(schema.articleSegments)
          .where(eq(schema.articleSegments.articleVersionId, row.version.id))
          .orderBy(schema.articleSegments.position),
        database.select().from(schema.articleAssets).where(eq(schema.articleAssets.articleVersionId, row.version.id)),
      ]);
      const article = projectArticleReader(rawArticle(row, segments, assets));
      return article ? { article, reason: "found" as const } : { article: null, reason: "unpublished" as const };
    },
  };
}
