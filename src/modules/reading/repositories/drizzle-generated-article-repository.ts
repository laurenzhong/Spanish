import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import { articleId, articleReference } from "../domain/reading-state";
import { generatedStoryEstimatedMinutes, normalizeGeneratedStoryPayload, type GeneratedStoryCard, type GeneratedStoryReader } from "../domain/generated-story";
import type { GeneratedArticleRepository, GeneratedStoryListQuery } from "./generated-article-repository";

type Database<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

export function createDrizzleGeneratedArticleRepository<TResult extends PgQueryResultHKT>(database: Database<TResult>): GeneratedArticleRepository {
  async function findRow(userId: string, value: string) {
    const reference = articleReference(value);
    const [row] = await database
      .select({
        generatedId: schema.userGeneratedArticles.id,
        generatedAt: schema.userGeneratedArticles.createdAt,
        articleId: schema.articles.id,
        stableKey: schema.articles.stableKey,
        articleVersionId: schema.articleVersions.id,
        version: schema.articleVersions.version,
        contentHash: schema.articleVersions.contentHash,
        locale: schema.articleVersions.locale,
        title: schema.articleVersions.title,
        summary: schema.articleVersions.summary,
        cefr: schema.articleVersions.cefrLevel,
        topics: schema.articleVersions.topics,
        region: schema.articleVersions.region,
        register: schema.articleVersions.register,
        format: schema.articleVersions.format,
        estimatedReadingMinutes: schema.articleVersions.estimatedReadingMinutes,
        sourceName: schema.articleSources.sourceName,
        sourceUrl: schema.articleSources.sourceUrl,
        attribution: schema.articleSources.attribution,
        oralTransferType: schema.articleVersions.oralTransferType,
      })
      .from(schema.userGeneratedArticles)
      .innerJoin(schema.articleVersions, eq(schema.userGeneratedArticles.articleVersionId, schema.articleVersions.id))
      .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
      .innerJoin(schema.articleSources, eq(schema.articleVersions.sourceId, schema.articleSources.id))
      .where(and(eq(schema.userGeneratedArticles.userId, userId), eq(schema.articles.stableKey, reference.stableKey), eq(schema.articleVersions.version, reference.version)))
      .limit(1);
    return row ?? null;
  }

  async function project(userId: string, row: NonNullable<Awaited<ReturnType<typeof findRow>>>): Promise<GeneratedStoryReader> {
    const segments = await database
      .select({ position: schema.articleSegments.position, text: schema.articleSegments.sourceText })
      .from(schema.articleSegments)
      .where(eq(schema.articleSegments.articleVersionId, row.articleVersionId))
      .orderBy(schema.articleSegments.position);
    return {
      id: articleId(row.stableKey, row.version),
      stableKey: row.stableKey,
      version: row.version,
      locale: row.locale,
      title: row.title,
      summary: row.summary,
      cefr: row.cefr as GeneratedStoryReader["cefr"],
      topics: row.topics ?? [],
      region: row.region,
      register: row.register,
      format: row.format as GeneratedStoryReader["format"],
      estimatedReadingMinutes: row.estimatedReadingMinutes,
      sourceName: row.sourceName,
      author: null,
      publicationDate: null,
      assets: { audio: false, chineseSummary: false, wordHelp: false, image: false },
      oralTransferType: row.oralTransferType as GeneratedStoryReader["oralTransferType"],
      contentHash: row.contentHash,
      sourceUrl: row.sourceUrl,
      attribution: row.attribution,
      segments,
      origin: "generated",
      generatedAt: row.generatedAt,
    };
  }

  return {
    async create(userId, request, result, requestId, idempotencyKey) {
      const existing = await database
        .select({
          stableKey: schema.articles.stableKey,
          version: schema.articleVersions.version,
          prompt: schema.userGeneratedArticles.prompt,
          cefr: schema.userGeneratedArticles.cefr,
          length: schema.userGeneratedArticles.length,
          format: schema.userGeneratedArticles.format,
          keywords: schema.userGeneratedArticles.keywords,
        })
        .from(schema.userGeneratedArticles)
        .innerJoin(schema.articleVersions, eq(schema.userGeneratedArticles.articleVersionId, schema.articleVersions.id))
        .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
        .where(and(eq(schema.userGeneratedArticles.userId, userId), eq(schema.userGeneratedArticles.idempotencyKey, idempotencyKey)))
        .limit(1);
      if (existing[0]) {
        const row = existing[0];
        const same = row.prompt === request.prompt && row.cefr === request.cefr && row.length === request.length && row.format === request.format && JSON.stringify(row.keywords) === JSON.stringify(request.keywords);
        if (!same) throw new Error("GENERATED_STORY_IDEMPOTENCY_CONFLICT");
        const found = await findRow(userId, articleId(row.stableKey, row.version));
        if (!found) throw new Error("GENERATED_STORY_WRITE_FAILED");
        return project(userId, found);
      }

      const payload = normalizeGeneratedStoryPayload(result);
      const stableKey = `generated-${randomUUID()}`;
      const contentHash = createHash("sha256").update(JSON.stringify({ title: payload.title, summary: payload.summary, segments: payload.segments, cefr: payload.cefr, topics: payload.topics, register: payload.register })).digest("hex");
      const created = await database.transaction(async (transaction) => {
        const [source] = await transaction.insert(schema.articleSources).values({ sourceType: "ai-generated", sourceName: "Sueño Story Bot", attribution: "AI-generated private draft", license: "original", copyrightStatus: "cleared", reviewNotes: "Private generated article; not public content." }).returning({ id: schema.articleSources.id });
        const [article] = await transaction.insert(schema.articles).values({ stableKey }).returning({ id: schema.articles.id });
        const [version] = await transaction.insert(schema.articleVersions).values({
          articleId: article!.id,
          sourceId: source!.id,
          version: 1,
          locale: "es-ES",
          title: payload.title,
          summary: payload.summary,
          contentHash,
          cefrLevel: payload.cefr,
          topics: payload.topics,
          region: "generated",
          register: payload.register,
          format: request.format,
          estimatedReadingMinutes: generatedStoryEstimatedMinutes(payload.segments),
          assets: [{ assetType: "audio", available: false }, { assetType: "chinese_summary", available: false }, { assetType: "word_help", available: false }, { assetType: "image", available: false }],
          relatedExpressionKeys: [],
          relatedGoalKeys: [],
          relatedTagKeys: [],
          oralTransferType: "none",
          status: "published",
          publishedAt: new Date(),
        }).returning({ id: schema.articleVersions.id });
        await transaction.insert(schema.articleSegments).values(payload.segments.map((text, position) => ({ articleVersionId: version!.id, position, sourceText: text })));
        await transaction.insert(schema.userGeneratedArticles).values({ userId, articleVersionId: version!.id, prompt: request.prompt, cefr: request.cefr, length: request.length, format: request.format, keywords: [...request.keywords], provider: result.provider, modelVersion: result.modelVersion, providerRequestId: result.providerRequestId, requestId, idempotencyKey, contentHash, status: "ready" });
        return { stableKey, version: 1 };
      });
      const found = await findRow(userId, articleId(created.stableKey, created.version));
      if (!found) throw new Error("GENERATED_STORY_WRITE_FAILED");
      return project(userId, found);
    },

    async findById(userId, value) {
      const row = await findRow(userId, value);
      return row ? project(userId, row) : null;
    },

    async list(userId, query: GeneratedStoryListQuery = {}) {
      const pageSize = Math.min(Math.max(query.pageSize ?? 12, 1), 24);
      const offset = Math.max(Number.parseInt(query.cursor ?? "0", 10) || 0, 0);
      const term = query.search?.trim();
      const rows = await database
        .select({
          generatedId: schema.userGeneratedArticles.id,
          generatedAt: schema.userGeneratedArticles.createdAt,
          stableKey: schema.articles.stableKey,
          version: schema.articleVersions.version,
          contentHash: schema.articleVersions.contentHash,
          locale: schema.articleVersions.locale,
          title: schema.articleVersions.title,
          summary: schema.articleVersions.summary,
          cefr: schema.articleVersions.cefrLevel,
          topics: schema.articleVersions.topics,
          region: schema.articleVersions.region,
          register: schema.articleVersions.register,
          format: schema.articleVersions.format,
          estimatedReadingMinutes: schema.articleVersions.estimatedReadingMinutes,
          sourceName: schema.articleSources.sourceName,
          oralTransferType: schema.articleVersions.oralTransferType,
        })
        .from(schema.userGeneratedArticles)
        .innerJoin(schema.articleVersions, eq(schema.userGeneratedArticles.articleVersionId, schema.articleVersions.id))
        .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
        .innerJoin(schema.articleSources, eq(schema.articleVersions.sourceId, schema.articleSources.id))
        .where(and(eq(schema.userGeneratedArticles.userId, userId), term ? or(ilike(schema.articleVersions.title, `%${term}%`), ilike(schema.articleVersions.summary, `%${term}%`)) : undefined))
        .orderBy(desc(schema.userGeneratedArticles.createdAt))
        .limit(pageSize + offset + 1);
      const page = rows.slice(offset, offset + pageSize);
      const articles: GeneratedStoryCard[] = page.map((row) => ({
        id: articleId(row.stableKey, row.version), stableKey: row.stableKey, version: row.version, locale: row.locale, title: row.title, summary: row.summary, cefr: row.cefr as GeneratedStoryCard["cefr"], topics: row.topics ?? [], region: row.region, register: row.register, format: row.format as GeneratedStoryCard["format"], estimatedReadingMinutes: row.estimatedReadingMinutes, sourceName: row.sourceName, author: null, publicationDate: null, assets: { audio: false, chineseSummary: false, wordHelp: false, image: false }, oralTransferType: row.oralTransferType as GeneratedStoryCard["oralTransferType"], origin: "generated", generatedAt: row.generatedAt,
      }));
      return { articles, nextCursor: offset + page.length < rows.length ? String(offset + page.length) : null, hasMore: offset + page.length < rows.length };
    },

    async delete(userId, value) {
      const reference = articleReference(value);
      const [row] = await database
        .select({ generatedId: schema.userGeneratedArticles.id, articleId: schema.articles.id, sourceId: schema.articleVersions.sourceId })
        .from(schema.userGeneratedArticles)
        .innerJoin(schema.articleVersions, eq(schema.userGeneratedArticles.articleVersionId, schema.articleVersions.id))
        .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
        .where(and(eq(schema.userGeneratedArticles.userId, userId), eq(schema.articles.stableKey, reference.stableKey), eq(schema.articleVersions.version, reference.version)))
        .limit(1);
      if (!row) return false;
      await database.transaction(async (transaction) => {
        await transaction.delete(schema.userGeneratedArticles).where(eq(schema.userGeneratedArticles.id, row.generatedId));
        await transaction.delete(schema.articles).where(eq(schema.articles.id, row.articleId));
        await transaction.delete(schema.articleSources).where(eq(schema.articleSources.id, row.sourceId));
      });
      return true;
    },
  };
}
