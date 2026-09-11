import { z } from "zod";

import {
  cefrLevelSchema,
  contentStatusSchema,
  copyrightStatusSchema,
  dateTimeSchema,
  jsonObjectSchema,
  localeSchema,
  localizedTextSchema,
  positionSchema,
  positiveVersionSchema,
  reviewStatusSchema,
  sourceLicenseSchema,
  stableKeySchema,
} from "./primitives";

const domainSchema = z
  .object({
    stableKey: stableKeySchema,
    title: localizedTextSchema,
    description: localizedTextSchema,
    position: positionSchema,
    status: contentStatusSchema,
  })
  .strict();

const goalSchema = z
  .object({
    stableKey: stableKeySchema,
    domainKey: stableKeySchema,
    title: localizedTextSchema,
    description: localizedTextSchema,
    cefrMin: cefrLevelSchema,
    cefrMax: cefrLevelSchema,
    position: positionSchema,
    status: contentStatusSchema,
  })
  .strict();

const tagSchema = z
  .object({
    stableKey: stableKeySchema,
    category: z.enum([
      "domain",
      "task",
      "chunk",
      "grammar",
      "pronunciation",
      "register",
      "relationship",
      "region",
      "cefr",
      "transfer",
      "fluency",
    ]),
    label: localizedTextSchema,
    description: localizedTextSchema,
    isActive: z.boolean(),
  })
  .strict();

const chunkSchema = z
  .object({
    text: z.string().trim().min(1).max(300),
    kind: z.enum(["sense_group", "target", "connector"]),
    stressed: z.boolean(),
  })
  .strict();

const slotSchema = z
  .object({
    key: stableKeySchema,
    description: localizedTextSchema,
    examples: z.array(z.string().trim().min(1).max(200)).min(2),
  })
  .strict();

const teachingNoteSchema = z
  .object({
    summary: localizedTextSchema,
    details: localizedTextSchema,
  })
  .strict();

const expressionVariantSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    usageNotes: localizedTextSchema,
    region: z.string().trim().min(2).max(40),
    register: z.string().trim().min(2).max(80),
    position: positionSchema,
    status: contentStatusSchema,
  })
  .strict();

const expressionTagSchema = z
  .object({
    tagKey: stableKeySchema,
    weight: z.number().positive().max(1),
    scoring: z.boolean(),
  })
  .strict();

const expressionSchema = z
  .object({
    stableKey: stableKeySchema,
    version: positiveVersionSchema,
    goalKey: stableKeySchema,
    locale: localeSchema,
    text: z.string().trim().min(1).max(1_000),
    translations: localizedTextSchema,
    communicativeIntent: localizedTextSchema,
    chunks: z.array(chunkSchema).min(1),
    targetChunks: z.array(z.string().trim().min(1).max(200)).min(1),
    slots: z.array(slotSchema),
    grammar: teachingNoteSchema,
    pronunciation: teachingNoteSchema,
    usage: z
      .object({
        summary: localizedTextSchema,
        avoidWhen: localizedTextSchema,
        relationshipTypes: z.array(stableKeySchema).min(1),
        toneEffects: z.array(z.string().trim().min(1).max(100)).min(1),
      })
      .strict(),
    cefr: cefrLevelSchema,
    register: z.string().trim().min(2).max(80),
    region: z.string().trim().min(2).max(40),
    frequency: z.enum(["core", "common", "extension"]),
    status: contentStatusSchema,
    publishedAt: dateTimeSchema.optional(),
    variants: z.array(expressionVariantSchema).min(2),
    tags: z.array(expressionTagSchema).min(1),
  })
  .strict();

const promptSetSchema = z
  .object({
    level1: localizedTextSchema,
    level2: localizedTextSchema,
    level3: localizedTextSchema,
  })
  .strict();

const scenarioTaskSchema = z
  .object({
    position: positionSchema,
    goalKey: stableKeySchema,
    prompt: localizedTextSchema,
    successCriteria: jsonObjectSchema,
    targetExpressionKeys: z.array(stableKeySchema).min(1),
    prompts: promptSetSchema,
    transfer: z
      .object({
        changedInformation: localizedTextSchema,
        changedRelationship: localizedTextSchema,
        unfamiliarVariant: localizedTextSchema,
      })
      .strict(),
  })
  .strict();

const scenarioPracticeConfigurationSchema = z
  .object({
    temporaryCharacter: z
      .object({
        displayName: z.string().trim().min(1).max(120),
        role: z.string().trim().min(1).max(160),
        locale: localeSchema,
        tone: z.string().trim().min(1).max(240),
      })
      .strict(),
    openingLine: localizedTextSchema,
    recommendedTurnCount: z.number().int().min(3).max(12),
    fictionalContext: z.boolean(),
    conditions: z
      .array(
        z
          .object({
            stableKey: stableKeySchema,
            afterUserTurns: z.number().int().positive().max(10),
            prompt: localizedTextSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const scenarioSchema = z
  .object({
    stableKey: stableKeySchema,
    version: positiveVersionSchema,
    title: localizedTextSchema,
    description: localizedTextSchema,
    setting: z.string().trim().min(2).max(120),
    relationshipType: stableKeySchema,
    cefr: cefrLevelSchema,
    status: contentStatusSchema,
    tasks: z.array(scenarioTaskSchema).min(1),
    practice: scenarioPracticeConfigurationSchema.optional(),
  })
  .strict();

const contentSegmentSchema = z
  .object({
    position: positionSchema,
    text: z.string().trim().min(1).max(4_000),
    translations: localizedTextSchema,
    chunks: z.array(chunkSchema).min(1),
  })
  .strict();

const contentActivitySchema = z
  .object({
    position: positionSchema,
    segmentPosition: positionSchema.optional(),
    activityType: z.enum([
      "listening",
      "shadowing",
      "reading",
      "typing",
      "speaking",
      "transfer",
    ]),
    modality: z.enum(["speech", "typing", "listening", "reading"]),
    instructions: localizedTextSchema,
    configuration: jsonObjectSchema,
  })
  .strict();

const contentSourceSchema = z
  .object({
    sourceType: z.enum([
      "original",
      "ai_assisted_original",
      "public_domain",
      "creative_commons",
      "licensed",
      "short_quote",
    ]),
    title: z.string().trim().min(1).max(500),
    author: z.string().trim().min(1).max(300).optional(),
    sourceUrl: z.url().optional(),
    license: sourceLicenseSchema,
    attribution: z.string().trim().min(1).max(1_000).optional(),
    licenseEvidence: z.string().trim().min(1).max(2_000).optional(),
    copyrightStatus: copyrightStatusSchema,
    reviewNotes: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

const contentPackSchema = z
  .object({
    stableKey: stableKeySchema,
    version: positiveVersionSchema,
    title: localizedTextSchema,
    summary: localizedTextSchema,
    cefr: cefrLevelSchema,
    status: contentStatusSchema,
    publishedAt: dateTimeSchema.optional(),
    segments: z.array(contentSegmentSchema).min(1),
    activities: z.array(contentActivitySchema).min(1),
    sources: z.array(contentSourceSchema).min(1),
  })
  .strict();

const canonFactSchema = z
  .object({
    factKey: stableKeySchema,
    value: jsonObjectSchema,
    sensitivity: z.enum(["normal", "sensitive", "private"]),
    version: positiveVersionSchema,
    isActive: z.boolean(),
  })
  .strict();

const characterSchema = z
  .object({
    stableKey: stableKeySchema,
    version: positiveVersionSchema,
    displayName: z.string().trim().min(1).max(120),
    avatarUrl: z.url().optional(),
    homeLocation: z.string().trim().min(1).max(200),
    profile: jsonObjectSchema,
    status: contentStatusSchema,
    canonFacts: z.array(canonFactSchema),
  })
  .strict();

const articleAssetSchema = z
  .object({
    assetType: z.enum(["audio", "chinese_summary", "word_help", "image"]),
    available: z.boolean(),
    sourceUrl: z.url().optional(),
    license: sourceLicenseSchema.optional(),
    attribution: z.string().trim().min(1).max(1_000).optional(),
    copyrightStatus: copyrightStatusSchema,
    altText: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const articleSourceSchema = z
  .object({
    sourceType: z.enum([
      "original",
      "ai_assisted_original",
      "public_domain",
      "creative_commons",
      "licensed",
      "short_quote",
    ]),
    sourceName: z.string().trim().min(1).max(300),
    author: z.string().trim().min(1).max(300).optional(),
    sourceUrl: z.url().optional(),
    publicationDate: z.iso.date().optional(),
    license: sourceLicenseSchema,
    attribution: z.string().trim().min(1).max(1_000).optional(),
    licenseEvidence: z.string().trim().min(1).max(2_000).optional(),
    copyrightStatus: copyrightStatusSchema,
    reviewNotes: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

const articleSegmentSchema = z
  .object({
    position: positionSchema,
    text: z.string().trim().min(1).max(8_000),
  })
  .strict();

const articleSchema = z
  .object({
    stableKey: stableKeySchema,
    version: positiveVersionSchema,
    locale: localeSchema,
    title: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(4_000),
    source: articleSourceSchema,
    publishedAt: dateTimeSchema.optional(),
    curatedAt: dateTimeSchema.optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    cefr: cefrLevelSchema,
    topics: z.array(stableKeySchema).min(1),
    region: z.string().trim().min(2).max(40),
    register: z.string().trim().min(2).max(80),
    format: z.enum(["news", "essay", "dialogue", "guide", "story"]),
    estimatedReadingMinutes: z.number().int().positive().max(240),
    assets: z.array(articleAssetSchema),
    relatedExpressionKeys: z.array(stableKeySchema),
    relatedGoalKeys: z.array(stableKeySchema),
    relatedTagKeys: z.array(stableKeySchema),
    oralTransferType: z.enum(["none", "summary", "opinion", "personal_transfer"]),
    status: contentStatusSchema,
    changeReason: z.string().trim().min(1).max(2_000).optional(),
    reviewNotes: z.string().trim().min(1).max(2_000).optional(),
    segments: z.array(articleSegmentSchema).min(1),
  })
  .strict();

const reviewEntityTypeSchema = z.enum([
  "communication_domain",
  "learning_goal",
  "expression",
  "scenario",
  "content_pack",
  "character",
  "article",
]);

const contentReviewSchema = z
  .object({
    entityType: reviewEntityTypeSchema,
    stableKey: stableKeySchema,
    version: positiveVersionSchema.optional(),
    locale: localeSchema,
    status: reviewStatusSchema,
    reviewerReference: z.string().trim().min(1).max(300).optional(),
    notes: z.string().trim().min(1).max(2_000).optional(),
    reviewedAt: dateTimeSchema.optional(),
  })
  .strict();

export const contentBundleSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    bundle: z
      .object({
        stableKey: stableKeySchema,
        version: positiveVersionSchema,
        defaultLocale: localeSchema,
        nativeLanguage: localeSchema,
        description: z.string().trim().min(1).max(1_000),
      })
      .strict(),
    domains: z.array(domainSchema).min(1),
    goals: z.array(goalSchema).min(1),
    tags: z.array(tagSchema).min(1),
    expressions: z.array(expressionSchema).min(1),
    scenarios: z.array(scenarioSchema),
    contentPacks: z.array(contentPackSchema),
    characters: z.array(characterSchema),
    articles: z.array(articleSchema).default([]),
    reviews: z.array(contentReviewSchema),
  })
  .strict();

export type ContentBundle = z.infer<typeof contentBundleSchema>;
export type ContentReview = z.infer<typeof contentReviewSchema>;
export type ReviewEntityType = z.infer<typeof reviewEntityTypeSchema>;
