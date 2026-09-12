import { z } from "zod";

import {
  contentBundleSchema,
  type ContentBundle,
  type ReviewEntityType,
} from "../schemas";
import { hashArticleContent } from "./content-hash";

const cefrOrder = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const versionedReviewTypes = new Set<ReviewEntityType>([
  "expression",
  "scenario",
  "content_pack",
  "character",
  "article",
]);

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

function addDuplicateIssues(
  values: readonly string[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        message: `Duplicate key: ${value}`,
        path: [...path, index],
      });
    }
    seen.add(value);
  });
}

function validateBundle(bundle: ContentBundle, ctx: z.RefinementCtx) {
  addDuplicateIssues(
    bundle.domains.map((domain) => domain.stableKey),
    ["domains"],
    ctx,
  );
  addDuplicateIssues(
    bundle.articles.map((article) =>
      versionedKey(article.stableKey, article.version),
    ),
    ["articles"],
    ctx,
  );
  addDuplicateIssues(
    bundle.goals.map((goal) => goal.stableKey),
    ["goals"],
    ctx,
  );
  addDuplicateIssues(
    bundle.tags.map((tag) => tag.stableKey),
    ["tags"],
    ctx,
  );
  addDuplicateIssues(
    bundle.expressions.map((expression) =>
      versionedKey(expression.stableKey, expression.version),
    ),
    ["expressions"],
    ctx,
  );
  addDuplicateIssues(
    bundle.scenarios.map((scenario) =>
      versionedKey(scenario.stableKey, scenario.version),
    ),
    ["scenarios"],
    ctx,
  );
  addDuplicateIssues(
    bundle.contentPacks.map((pack) => versionedKey(pack.stableKey, pack.version)),
    ["contentPacks"],
    ctx,
  );
  addDuplicateIssues(
    bundle.characters.map((character) =>
      versionedKey(character.stableKey, character.version),
    ),
    ["characters"],
    ctx,
  );

  const domainsByKey = new Map(
    bundle.domains.map((domain) => [domain.stableKey, domain]),
  );
  const goalsByKey = new Map(
    bundle.goals.map((goal) => [goal.stableKey, goal]),
  );
  const expressionsByKey = new Map(
    bundle.expressions.map((expression) => [expression.stableKey, expression]),
  );
  const domainKeys = new Set(domainsByKey.keys());
  const goalKeys = new Set(goalsByKey.keys());
  const tagKeys = new Set(bundle.tags.map((tag) => tag.stableKey));
  const expressionKeys = new Set(
    bundle.expressions.map((expression) => expression.stableKey),
  );

  bundle.articles.forEach((article, articleIndex) => {
    if (hashArticleContent(article) !== article.contentHash) {
      ctx.addIssue({
        code: "custom",
        message: "Article contentHash does not match normalized article content.",
        path: ["articles", articleIndex, "contentHash"],
      });
    }
    addDuplicateIssues(
      article.segments.map((segment) => String(segment.position)),
      ["articles", articleIndex, "segments"],
      ctx,
    );
    const positions = article.segments.map((segment) => segment.position).sort((a, b) => a - b);
    positions.forEach((position, index) => {
      if (position !== index) {
        ctx.addIssue({
          code: "custom",
          message: "Article segment positions must be continuous from zero.",
          path: ["articles", articleIndex, "segments"],
        });
      }
    });
    const source = article.source;
    if (
      source.license !== "original" &&
      (!source.sourceUrl || !source.attribution || !source.licenseEvidence)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Non-original article sources require sourceUrl, attribution, and licenseEvidence.",
        path: ["articles", articleIndex, "source"],
      });
    }
    article.assets.forEach((asset, assetIndex) => {
      if (asset.available && asset.license !== "original" &&
        (!asset.sourceUrl || !asset.attribution)) {
        ctx.addIssue({
          code: "custom",
          message: "Available non-original article assets require sourceUrl and attribution.",
          path: ["articles", articleIndex, "assets", assetIndex],
        });
      }
      if (article.status === "published" && asset.available && asset.copyrightStatus !== "cleared") {
        ctx.addIssue({
          code: "custom",
          message: "Published article assets require cleared copyright status.",
          path: ["articles", articleIndex, "assets", assetIndex, "copyrightStatus"],
        });
      }
    });
    article.relatedExpressionKeys.forEach((key, keyIndex) => {
      if (!expressionKeys.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown related expression: ${key}`,
          path: ["articles", articleIndex, "relatedExpressionKeys", keyIndex],
        });
      }
    });
    article.relatedGoalKeys.forEach((key, keyIndex) => {
      if (!goalKeys.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown related goal: ${key}`,
          path: ["articles", articleIndex, "relatedGoalKeys", keyIndex],
        });
      }
    });
    article.relatedTagKeys.forEach((key, keyIndex) => {
      if (!tagKeys.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown related tag: ${key}`,
          path: ["articles", articleIndex, "relatedTagKeys", keyIndex],
        });
      }
    });
    if (article.segments.some((segment) => /<[^>]+>/u.test(segment.text))) {
      ctx.addIssue({
        code: "custom",
        message: "Article segments must contain cleaned plain text, not HTML.",
        path: ["articles", articleIndex, "segments"],
      });
    }
    if (article.status === "published") {
      if (!article.publishedAt) {
        ctx.addIssue({
          code: "custom",
          message: "Published articles require publishedAt.",
          path: ["articles", articleIndex, "publishedAt"],
        });
      }
      if (source.copyrightStatus !== "cleared") {
        ctx.addIssue({
          code: "custom",
          message: "Published articles require cleared copyright status.",
          path: ["articles", articleIndex, "source", "copyrightStatus"],
        });
      }
    }
  });

  bundle.goals.forEach((goal, index) => {
    if (!domainKeys.has(goal.domainKey)) {
      ctx.addIssue({
        code: "custom",
        message: `Unknown domainKey: ${goal.domainKey}`,
        path: ["goals", index, "domainKey"],
      });
    }
    if (cefrOrder.indexOf(goal.cefrMin) > cefrOrder.indexOf(goal.cefrMax)) {
      ctx.addIssue({
        code: "custom",
        message: "cefrMin cannot be higher than cefrMax.",
        path: ["goals", index, "cefrMin"],
      });
    }
  });

  bundle.expressions.forEach((expression, expressionIndex) => {
    if (!goalKeys.has(expression.goalKey)) {
      ctx.addIssue({
        code: "custom",
        message: `Unknown goalKey: ${expression.goalKey}`,
        path: ["expressions", expressionIndex, "goalKey"],
      });
    }
    addDuplicateIssues(
      expression.variants.map((variant) => String(variant.position)),
      ["expressions", expressionIndex, "variants"],
      ctx,
    );
    addDuplicateIssues(
      expression.tags.map((tag) => tag.tagKey),
      ["expressions", expressionIndex, "tags"],
      ctx,
    );
    expression.tags.forEach((tag, tagIndex) => {
      if (!tagKeys.has(tag.tagKey)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown tagKey: ${tag.tagKey}`,
          path: ["expressions", expressionIndex, "tags", tagIndex, "tagKey"],
        });
      }
    });
    const scoringWeight = expression.tags
      .filter((tag) => tag.scoring)
      .reduce((sum, tag) => sum + tag.weight, 0);
    if (Math.abs(scoringWeight - 1) > 0.000_001) {
      ctx.addIssue({
        code: "custom",
        message: "Scoring tag weights must sum to 1.",
        path: ["expressions", expressionIndex, "tags"],
      });
    }
    if (expression.status === "published") {
      if (!expression.publishedAt) {
        ctx.addIssue({
          code: "custom",
          message: "Published expressions require publishedAt.",
          path: ["expressions", expressionIndex, "publishedAt"],
        });
      }
      if (!expression.translations[bundle.bundle.nativeLanguage]) {
        ctx.addIssue({
          code: "custom",
          message: `Published expressions require a ${bundle.bundle.nativeLanguage} translation.`,
          path: ["expressions", expressionIndex, "translations"],
        });
      }
      if (expression.variants.some((variant) => variant.status !== "published")) {
        ctx.addIssue({
          code: "custom",
          message: "Published expressions require published variants.",
          path: ["expressions", expressionIndex, "variants"],
        });
      }
      const goal = goalsByKey.get(expression.goalKey);
      const domain = goal ? domainsByKey.get(goal.domainKey) : undefined;
      if (goal?.status !== "published" || domain?.status !== "published") {
        ctx.addIssue({
          code: "custom",
          message:
            "Published expressions require a published learning goal and communication domain.",
          path: ["expressions", expressionIndex, "goalKey"],
        });
      }
    }
  });

  bundle.scenarios.forEach((scenario, scenarioIndex) => {
    addDuplicateIssues(
      scenario.tasks.map((task) => String(task.position)),
      ["scenarios", scenarioIndex, "tasks"],
      ctx,
    );
    scenario.tasks.forEach((task, taskIndex) => {
      if (!goalKeys.has(task.goalKey)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown goalKey: ${task.goalKey}`,
          path: ["scenarios", scenarioIndex, "tasks", taskIndex, "goalKey"],
        });
      }
      task.targetExpressionKeys.forEach((key, targetIndex) => {
        if (!expressionKeys.has(key)) {
          ctx.addIssue({
            code: "custom",
            message: `Unknown target expression: ${key}`,
            path: [
              "scenarios",
              scenarioIndex,
              "tasks",
              taskIndex,
              "targetExpressionKeys",
              targetIndex,
            ],
          });
        }
      });
    });
    if (
      scenario.status === "published" &&
      scenario.tasks.some(
        (task) =>
          goalsByKey.get(task.goalKey)?.status !== "published" ||
          task.targetExpressionKeys.some(
            (key) => expressionsByKey.get(key)?.status !== "published",
          ),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Published scenarios require published goals and target expressions.",
        path: ["scenarios", scenarioIndex, "tasks"],
      });
    }
  });

  bundle.contentPacks.forEach((pack, packIndex) => {
    addDuplicateIssues(
      pack.segments.map((segment) => String(segment.position)),
      ["contentPacks", packIndex, "segments"],
      ctx,
    );
    addDuplicateIssues(
      pack.activities.map((activity) => String(activity.position)),
      ["contentPacks", packIndex, "activities"],
      ctx,
    );
    const segmentPositions = new Set(
      pack.segments.map((segment) => segment.position),
    );
    pack.activities.forEach((activity, activityIndex) => {
      if (
        activity.segmentPosition !== undefined &&
        !segmentPositions.has(activity.segmentPosition)
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown segment position: ${activity.segmentPosition}`,
          path: [
            "contentPacks",
            packIndex,
            "activities",
            activityIndex,
            "segmentPosition",
          ],
        });
      }
    });
    pack.sources.forEach((source, sourceIndex) => {
      const externalLicense = source.license !== "original";
      if (
        externalLicense &&
        (!source.sourceUrl || !source.attribution || !source.licenseEvidence)
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Non-original sources require sourceUrl, attribution, and licenseEvidence.",
          path: ["contentPacks", packIndex, "sources", sourceIndex],
        });
      }
      if (pack.status === "published" && source.copyrightStatus !== "cleared") {
        ctx.addIssue({
          code: "custom",
          message: "Published content requires cleared copyright status.",
          path: [
            "contentPacks",
            packIndex,
            "sources",
            sourceIndex,
            "copyrightStatus",
          ],
        });
      }
    });
    if (pack.status === "published" && !pack.publishedAt) {
      ctx.addIssue({
        code: "custom",
        message: "Published content packs require publishedAt.",
        path: ["contentPacks", packIndex, "publishedAt"],
      });
    }
  });

  bundle.characters.forEach((character, characterIndex) => {
    addDuplicateIssues(
      character.canonFacts.map((fact) =>
        versionedKey(fact.factKey, fact.version),
      ),
      ["characters", characterIndex, "canonFacts"],
      ctx,
    );
  });

  const knownReviewEntities = new Set<string>([
    ...bundle.domains.map((item) =>
      reviewKey("communication_domain", item.stableKey),
    ),
    ...bundle.goals.map((item) => reviewKey("learning_goal", item.stableKey)),
    ...bundle.expressions.map((item) =>
      reviewKey("expression", item.stableKey, item.version),
    ),
    ...bundle.scenarios.map((item) =>
      reviewKey("scenario", item.stableKey, item.version),
    ),
    ...bundle.contentPacks.map((item) =>
      reviewKey("content_pack", item.stableKey, item.version),
    ),
    ...bundle.characters.map((item) =>
      reviewKey("character", item.stableKey, item.version),
    ),
    ...bundle.articles.map((item) =>
      reviewKey("article", item.stableKey, item.version),
    ),
  ]);
  const approvedReviews = new Set<string>();
  const approvedReviewLocales = new Map<string, Set<string>>();

  bundle.reviews.forEach((review, reviewIndex) => {
    const expectsVersion = versionedReviewTypes.has(review.entityType);
    if (expectsVersion !== (review.version !== undefined)) {
      ctx.addIssue({
        code: "custom",
        message: expectsVersion
          ? "This review entity requires a version."
          : "This review entity must not include a version.",
        path: ["reviews", reviewIndex, "version"],
      });
    }
    const key = reviewKey(review.entityType, review.stableKey, review.version);
    if (!knownReviewEntities.has(key)) {
      ctx.addIssue({
        code: "custom",
        message: `Review references an unknown entity: ${key}`,
        path: ["reviews", reviewIndex],
      });
    }
    if (review.status === "approved") {
      if (!review.reviewerReference || !review.reviewedAt) {
        ctx.addIssue({
          code: "custom",
          message:
            "Approved reviews require reviewerReference and reviewedAt.",
          path: ["reviews", reviewIndex],
        });
      }
      approvedReviews.add(key);
      const locales = approvedReviewLocales.get(key) ?? new Set<string>();
      locales.add(review.locale);
      approvedReviewLocales.set(key, locales);
    }
  });

  for (const expression of bundle.expressions) {
    if (expression.status !== "published") continue;
    const key = reviewKey("expression", expression.stableKey, expression.version);
    const locales = approvedReviewLocales.get(key);
    if (!locales?.has("es-ES") || !locales.has("zh-CN")) {
      ctx.addIssue({
        code: "custom",
        message:
          "Published expression requires approved es-ES and zh-CN reviews.",
        path: ["reviews"],
      });
    }
  }

  for (const scenario of bundle.scenarios) {
    if (scenario.status !== "published") continue;
    const key = reviewKey("scenario", scenario.stableKey, scenario.version);
    const locales = approvedReviewLocales.get(key);
    if (!locales?.has("es-ES") || !locales.has("zh-CN")) {
      ctx.addIssue({
        code: "custom",
        message:
          "Published scenario requires approved es-ES and zh-CN reviews.",
        path: ["reviews"],
      });
    }
  }

  const publishedEntities = [
    ...bundle.domains
      .filter((item) => item.status === "published")
      .map((item) => reviewKey("communication_domain", item.stableKey)),
    ...bundle.goals
      .filter((item) => item.status === "published")
      .map((item) => reviewKey("learning_goal", item.stableKey)),
    ...bundle.expressions
      .filter((item) => item.status === "published")
      .map((item) => reviewKey("expression", item.stableKey, item.version)),
    ...bundle.scenarios
      .filter((item) => item.status === "published")
      .map((item) => reviewKey("scenario", item.stableKey, item.version)),
    ...bundle.contentPacks
      .filter((item) => item.status === "published")
      .map((item) => reviewKey("content_pack", item.stableKey, item.version)),
    ...bundle.characters
      .filter((item) => item.status === "published")
      .map((item) => reviewKey("character", item.stableKey, item.version)),
    ...bundle.articles
      .filter((item) => item.status === "published")
      .map((item) => reviewKey("article", item.stableKey, item.version)),
  ];
  publishedEntities.forEach((key) => {
    if (!approvedReviews.has(key)) {
      ctx.addIssue({
        code: "custom",
        message: `Published entity requires an approved review: ${key}`,
        path: ["reviews"],
      });
    }
  });
}

export const validatedContentBundleSchema = contentBundleSchema.superRefine(
  validateBundle,
);

export function validateContentBundle(input: unknown): ContentBundle {
  return validatedContentBundleSchema.parse(input);
}
