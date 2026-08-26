import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  characterCanonFacts,
  characters,
  communicationDomains,
  contentBundleImports,
  contentPackActivities,
  contentPackSegments,
  contentPacks,
  contentReviews,
  contentSources,
  articleAssets,
  articleSegments,
  articleSources,
  articleVersions,
  articles,
  expressionTags,
  expressionVariants,
  expressions,
  learningGoals,
  scenarioTasks,
  scenarios,
  tags,
} from "@/src/shared/db/schema";
import * as databaseSchema from "@/src/shared/db/schema";

import type {
  ContentBundle,
  ReviewEntityType,
} from "../schemas/content-bundle";
import { ContentImportConflictError } from "./content-import-errors";
import { hashContentBundle } from "./content-hash";
import { validateContentBundle } from "./validate-content";

type ContentDatabase<TResult extends PgQueryResultHKT> = PgDatabase<
  TResult,
  typeof databaseSchema
>;

type ImportCounts = Readonly<{
  articles: number;
  characters: number;
  domains: number;
  expressions: number;
  goals: number;
  packs: number;
  reviews: number;
  scenarios: number;
  tags: number;
}>;

export type ContentImportResult = Readonly<{
  bundleKey: string;
  bundleVersion: number;
  contentHash: string;
  counts: ImportCounts;
  status: "imported" | "unchanged";
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertSameReference(
  entity: string,
  stableKey: string,
  existing: unknown,
  incoming: unknown,
) {
  if (canonical(existing) !== canonical(incoming)) {
    throw new ContentImportConflictError(
      `${entity} ${stableKey} already exists with different immutable content.`,
    );
  }
}

function versionedKey(stableKey: string, version: number) {
  return `${stableKey}@${version}`;
}

function reviewKey(
  entityType: ReviewEntityType,
  stableKey: string,
  version?: number,
) {
  return `${entityType}:${stableKey}${version === undefined ? "" : `@${version}`}`;
}

function importCounts(bundle: ContentBundle): ImportCounts {
  return {
    articles: bundle.articles.length,
    characters: bundle.characters.length,
    domains: bundle.domains.length,
    expressions: bundle.expressions.length,
    goals: bundle.goals.length,
    packs: bundle.contentPacks.length,
    reviews: bundle.reviews.length,
    scenarios: bundle.scenarios.length,
    tags: bundle.tags.length,
  };
}

export async function importContentBundle<TResult extends PgQueryResultHKT>(
  database: ContentDatabase<TResult>,
  input: unknown,
): Promise<ContentImportResult> {
  const bundle = validateContentBundle(input);
  const contentHash = hashContentBundle(bundle);
  const counts = importCounts(bundle);

  return database.transaction(async (transaction) => {
    const [previousImport] = await transaction
      .select({ contentHash: contentBundleImports.contentHash })
      .from(contentBundleImports)
      .where(
        and(
          eq(contentBundleImports.stableKey, bundle.bundle.stableKey),
          eq(contentBundleImports.bundleVersion, bundle.bundle.version),
        ),
      )
      .limit(1);

    if (previousImport) {
      if (previousImport.contentHash !== contentHash) {
        throw new ContentImportConflictError(
          `Bundle ${bundle.bundle.stableKey}@${bundle.bundle.version} already exists with a different content hash.`,
        );
      }
      return {
        bundleKey: bundle.bundle.stableKey,
        bundleVersion: bundle.bundle.version,
        contentHash,
        counts,
        status: "unchanged",
      };
    }

    const [claimedImport] = await transaction
      .insert(contentBundleImports)
      .values({
        stableKey: bundle.bundle.stableKey,
        bundleVersion: bundle.bundle.version,
        schemaVersion: bundle.schemaVersion,
        contentHash,
        entityCounts: counts,
      })
      .onConflictDoNothing({
        target: [
          contentBundleImports.stableKey,
          contentBundleImports.bundleVersion,
        ],
      })
      .returning({ contentHash: contentBundleImports.contentHash });

    if (!claimedImport) {
      const [concurrentImport] = await transaction
        .select({ contentHash: contentBundleImports.contentHash })
        .from(contentBundleImports)
        .where(
          and(
            eq(contentBundleImports.stableKey, bundle.bundle.stableKey),
            eq(contentBundleImports.bundleVersion, bundle.bundle.version),
          ),
        )
        .limit(1);
      if (concurrentImport?.contentHash !== contentHash) {
        throw new ContentImportConflictError(
          `Bundle ${bundle.bundle.stableKey}@${bundle.bundle.version} was claimed by different content.`,
        );
      }
      return {
        bundleKey: bundle.bundle.stableKey,
        bundleVersion: bundle.bundle.version,
        contentHash,
        counts,
        status: "unchanged",
      };
    }

    const domainIds = new Map<string, string>();
    for (const domain of bundle.domains) {
      const expected = {
        title: domain.title,
        description: domain.description,
        position: domain.position,
        status: domain.status,
      };
      const [existing] = await transaction
        .select({
          id: communicationDomains.id,
          title: communicationDomains.title,
          description: communicationDomains.description,
          position: communicationDomains.position,
          status: communicationDomains.status,
        })
        .from(communicationDomains)
        .where(eq(communicationDomains.stableKey, domain.stableKey))
        .limit(1);

      if (existing) {
        assertSameReference(
          "Communication domain",
          domain.stableKey,
          {
            title: existing.title,
            description: existing.description,
            position: existing.position,
            status: existing.status,
          },
          expected,
        );
        domainIds.set(domain.stableKey, existing.id);
      } else {
        const [inserted] = await transaction
          .insert(communicationDomains)
          .values({ stableKey: domain.stableKey, ...expected })
          .returning({ id: communicationDomains.id });
        domainIds.set(domain.stableKey, inserted!.id);
      }
    }

    const goalIds = new Map<string, string>();
    for (const goal of bundle.goals) {
      const domainId = domainIds.get(goal.domainKey)!;
      const expected = {
        domainId,
        title: goal.title,
        description: goal.description,
        cefrMin: goal.cefrMin,
        cefrMax: goal.cefrMax,
        position: goal.position,
        status: goal.status,
      };
      const [existing] = await transaction
        .select({
          id: learningGoals.id,
          domainId: learningGoals.domainId,
          title: learningGoals.title,
          description: learningGoals.description,
          cefrMin: learningGoals.cefrMin,
          cefrMax: learningGoals.cefrMax,
          position: learningGoals.position,
          status: learningGoals.status,
        })
        .from(learningGoals)
        .where(eq(learningGoals.stableKey, goal.stableKey))
        .limit(1);

      if (existing) {
        assertSameReference(
          "Learning goal",
          goal.stableKey,
          {
            domainId: existing.domainId,
            title: existing.title,
            description: existing.description,
            cefrMin: existing.cefrMin,
            cefrMax: existing.cefrMax,
            position: existing.position,
            status: existing.status,
          },
          expected,
        );
        goalIds.set(goal.stableKey, existing.id);
      } else {
        const [inserted] = await transaction
          .insert(learningGoals)
          .values({ stableKey: goal.stableKey, ...expected })
          .returning({ id: learningGoals.id });
        goalIds.set(goal.stableKey, inserted!.id);
      }
    }

    const tagIds = new Map<string, string>();
    for (const tag of bundle.tags) {
      const expected = {
        category: tag.category,
        label: tag.label,
        description: tag.description,
        isActive: tag.isActive,
      };
      const [existing] = await transaction
        .select({
          id: tags.id,
          category: tags.category,
          label: tags.label,
          description: tags.description,
          isActive: tags.isActive,
        })
        .from(tags)
        .where(eq(tags.stableKey, tag.stableKey))
        .limit(1);

      if (existing) {
        assertSameReference(
          "Tag",
          tag.stableKey,
          {
            category: existing.category,
            label: existing.label,
            description: existing.description,
            isActive: existing.isActive,
          },
          expected,
        );
        tagIds.set(tag.stableKey, existing.id);
      } else {
        const [inserted] = await transaction
          .insert(tags)
          .values({ stableKey: tag.stableKey, ...expected })
          .returning({ id: tags.id });
        tagIds.set(tag.stableKey, inserted!.id);
      }
    }

    const entityIds = new Map<string, string>();
    domainIds.forEach((id, key) =>
      entityIds.set(reviewKey("communication_domain", key), id),
    );
    goalIds.forEach((id, key) =>
      entityIds.set(reviewKey("learning_goal", key), id),
    );

    for (const expression of bundle.expressions) {
      const [existing] = await transaction
        .select({ id: expressions.id })
        .from(expressions)
        .where(
          and(
            eq(expressions.stableKey, expression.stableKey),
            eq(expressions.contentVersion, expression.version),
          ),
        )
        .limit(1);
      if (existing) {
        throw new ContentImportConflictError(
          `Expression ${versionedKey(expression.stableKey, expression.version)} already belongs to another import.`,
        );
      }

      const [inserted] = await transaction
        .insert(expressions)
        .values({
          goalId: goalIds.get(expression.goalKey)!,
          stableKey: expression.stableKey,
          sourceText: expression.text,
          translations: expression.translations,
          communicativeIntent: expression.communicativeIntent,
          chunks: expression.chunks,
          grammarNotes: {
            ...expression.grammar,
            slots: expression.slots,
            targetChunks: expression.targetChunks,
          },
          pronunciationNotes: expression.pronunciation,
          usageNotes: { locale: expression.locale, ...expression.usage },
          cefrLevel: expression.cefr,
          register: expression.register,
          region: expression.region,
          frequency: expression.frequency,
          contentVersion: expression.version,
          status: expression.status,
          publishedAt: expression.publishedAt
            ? new Date(expression.publishedAt)
            : null,
        })
        .returning({ id: expressions.id });
      const expressionId = inserted!.id;
      entityIds.set(
        reviewKey("expression", expression.stableKey, expression.version),
        expressionId,
      );

      await transaction.insert(expressionVariants).values(
        expression.variants.map((variant) => ({
          expressionId,
          variantText: variant.text,
          usageNotes: variant.usageNotes,
          region: variant.region,
          register: variant.register,
          position: variant.position,
          status: variant.status,
        })),
      );
      await transaction.insert(expressionTags).values(
        expression.tags.map((tag) => ({
          expressionId,
          tagId: tagIds.get(tag.tagKey)!,
          weight: tag.weight,
          scoring: tag.scoring,
        })),
      );
    }

    for (const scenario of bundle.scenarios) {
      const [existing] = await transaction
        .select({ id: scenarios.id })
        .from(scenarios)
        .where(
          and(
            eq(scenarios.stableKey, scenario.stableKey),
            eq(scenarios.contentVersion, scenario.version),
          ),
        )
        .limit(1);
      if (existing) {
        throw new ContentImportConflictError(
          `Scenario ${versionedKey(scenario.stableKey, scenario.version)} already belongs to another import.`,
        );
      }

      const [inserted] = await transaction
        .insert(scenarios)
        .values({
          stableKey: scenario.stableKey,
          title: scenario.title,
          description: scenario.description,
          setting: scenario.setting,
          relationshipType: scenario.relationshipType,
          cefrLevel: scenario.cefr,
          contentVersion: scenario.version,
          status: scenario.status,
        })
        .returning({ id: scenarios.id });
      const scenarioId = inserted!.id;
      entityIds.set(
        reviewKey("scenario", scenario.stableKey, scenario.version),
        scenarioId,
      );

      await transaction.insert(scenarioTasks).values(
        scenario.tasks.map((task) => ({
          scenarioId,
          goalId: goalIds.get(task.goalKey)!,
          prompt: task.prompt,
          successCriteria: {
            criteria: task.successCriteria,
            prompts: task.prompts,
            transfer: task.transfer,
          },
          targetExpressionKeys: task.targetExpressionKeys,
          position: task.position,
        })),
      );
    }

    for (const pack of bundle.contentPacks) {
      const [existing] = await transaction
        .select({ id: contentPacks.id })
        .from(contentPacks)
        .where(
          and(
            eq(contentPacks.stableKey, pack.stableKey),
            eq(contentPacks.contentVersion, pack.version),
          ),
        )
        .limit(1);
      if (existing) {
        throw new ContentImportConflictError(
          `Content pack ${versionedKey(pack.stableKey, pack.version)} already belongs to another import.`,
        );
      }

      const [inserted] = await transaction
        .insert(contentPacks)
        .values({
          stableKey: pack.stableKey,
          title: pack.title,
          summary: pack.summary,
          cefrLevel: pack.cefr,
          contentVersion: pack.version,
          status: pack.status,
          publishedAt: pack.publishedAt ? new Date(pack.publishedAt) : null,
        })
        .returning({ id: contentPacks.id });
      const contentPackId = inserted!.id;
      entityIds.set(
        reviewKey("content_pack", pack.stableKey, pack.version),
        contentPackId,
      );

      const segmentIds = new Map<number, string>();
      for (const segment of pack.segments) {
        const [insertedSegment] = await transaction
          .insert(contentPackSegments)
          .values({
            contentPackId,
            position: segment.position,
            sourceText: segment.text,
            translations: segment.translations,
            chunks: segment.chunks,
          })
          .returning({ id: contentPackSegments.id });
        segmentIds.set(segment.position, insertedSegment!.id);
      }

      await transaction.insert(contentPackActivities).values(
        pack.activities.map((activity) => ({
          contentPackId,
          segmentId:
            activity.segmentPosition === undefined
              ? null
              : segmentIds.get(activity.segmentPosition)!,
          activityType: activity.activityType,
          modality: activity.modality,
          instructions: activity.instructions,
          configuration: activity.configuration,
          position: activity.position,
        })),
      );
      await transaction.insert(contentSources).values(
        pack.sources.map((source) => ({
          contentPackId,
          sourceType: source.sourceType,
          title: source.title,
          author: source.author ?? null,
          sourceUrl: source.sourceUrl ?? null,
          license: source.license,
          attribution: source.attribution ?? null,
          licenseEvidence: source.licenseEvidence ?? null,
          copyrightStatus: source.copyrightStatus,
          reviewNotes: source.reviewNotes ?? null,
        })),
      );
    }

    for (const character of bundle.characters) {
      const [existing] = await transaction
        .select({ id: characters.id })
        .from(characters)
        .where(
          and(
            eq(characters.stableKey, character.stableKey),
            eq(characters.characterVersion, character.version),
          ),
        )
        .limit(1);
      if (existing) {
        throw new ContentImportConflictError(
          `Character ${versionedKey(character.stableKey, character.version)} already belongs to another import.`,
        );
      }

      const [inserted] = await transaction
        .insert(characters)
        .values({
          stableKey: character.stableKey,
          displayName: character.displayName,
          avatarUrl: character.avatarUrl ?? null,
          homeLocation: character.homeLocation,
          profile: character.profile,
          characterVersion: character.version,
          status: character.status,
        })
        .returning({ id: characters.id });
      const characterId = inserted!.id;
      entityIds.set(
        reviewKey("character", character.stableKey, character.version),
        characterId,
      );

      if (character.canonFacts.length > 0) {
        await transaction.insert(characterCanonFacts).values(
          character.canonFacts.map((fact) => ({
            characterId,
            factKey: fact.factKey,
            value: fact.value,
            sensitivity: fact.sensitivity,
            canonVersion: fact.version,
            isActive: fact.isActive,
          })),
        );
      }
    }

    for (const article of bundle.articles) {
      let articleId: string;
      const [existingArticle] = await transaction
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.stableKey, article.stableKey))
        .limit(1);
      if (existingArticle) {
        articleId = existingArticle.id;
      } else {
        const [insertedArticle] = await transaction
          .insert(articles)
          .values({ stableKey: article.stableKey })
          .returning({ id: articles.id });
        articleId = insertedArticle!.id;
      }

      const [existingVersion] = await transaction
        .select({ id: articleVersions.id, contentHash: articleVersions.contentHash })
        .from(articleVersions)
        .where(
          and(
            eq(articleVersions.articleId, articleId),
            eq(articleVersions.version, article.version),
          ),
        )
        .limit(1);
      if (existingVersion) {
        if (existingVersion.contentHash !== article.contentHash) {
          throw new ContentImportConflictError(
            `Article ${versionedKey(article.stableKey, article.version)} already exists with a different content hash.`,
          );
        }
        throw new ContentImportConflictError(
          `Article ${versionedKey(article.stableKey, article.version)} already belongs to another import.`,
        );
      }

      const [source] = await transaction
        .insert(articleSources)
        .values({
          sourceType: article.source.sourceType,
          sourceName: article.source.sourceName,
          author: article.source.author ?? null,
          sourceUrl: article.source.sourceUrl ?? null,
          publicationDate: article.source.publicationDate ?? null,
          license: article.source.license,
          attribution: article.source.attribution ?? null,
          licenseEvidence: article.source.licenseEvidence ?? null,
          copyrightStatus: article.source.copyrightStatus,
          reviewNotes: article.source.reviewNotes ?? null,
        })
        .returning({ id: articleSources.id });
      const [version] = await transaction
        .insert(articleVersions)
        .values({
          articleId,
          sourceId: source!.id,
          version: article.version,
          locale: article.locale,
          title: article.title,
          summary: article.summary,
          curatedAt: article.curatedAt ? new Date(article.curatedAt) : null,
          contentHash: article.contentHash,
          cefrLevel: article.cefr,
          topics: article.topics,
          region: article.region,
          register: article.register,
          format: article.format,
          estimatedReadingMinutes: article.estimatedReadingMinutes,
          assets: article.assets,
          relatedExpressionKeys: article.relatedExpressionKeys,
          relatedGoalKeys: article.relatedGoalKeys,
          relatedTagKeys: article.relatedTagKeys,
          oralTransferType: article.oralTransferType,
          status: article.status,
          publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
          changeReason: article.changeReason ?? null,
          reviewNotes: article.reviewNotes ?? null,
        })
        .returning({ id: articleVersions.id });
      const articleVersionId = version!.id;
      entityIds.set(reviewKey("article", article.stableKey, article.version), articleVersionId);

      await transaction.insert(articleSegments).values(
        article.segments.map((segment) => ({
          articleVersionId,
          position: segment.position,
          sourceText: segment.text,
        })),
      );
      if (article.assets.length > 0) {
        await transaction.insert(articleAssets).values(
          article.assets.map((asset) => ({
            articleVersionId,
            assetType: asset.assetType,
            available: asset.available,
            sourceUrl: asset.sourceUrl ?? null,
            license: asset.license ?? null,
            attribution: asset.attribution ?? null,
            copyrightStatus: asset.copyrightStatus,
            altText: asset.altText ?? null,
          })),
        );
      }
    }

    if (bundle.reviews.length > 0) {
      await transaction.insert(contentReviews).values(
        bundle.reviews.map((review) => ({
          entityType: review.entityType,
          entityId: entityIds.get(
            reviewKey(review.entityType, review.stableKey, review.version),
          )!,
          locale: review.locale,
          status: review.status,
          reviewerReference: review.reviewerReference ?? null,
          notes: review.notes ?? null,
          reviewedAt: review.reviewedAt ? new Date(review.reviewedAt) : null,
        })),
      );
    }

    return {
      bundleKey: bundle.bundle.stableKey,
      bundleVersion: bundle.bundle.version,
      contentHash,
      counts,
      status: "imported",
    };
  });
}
