import { z } from "zod";

import {
  candidateReviewDimensions,
  candidateReviewStatuses,
  candidateStatuses,
  sourceRightsStatuses,
} from "../domain";

export const sourceAdapterTypes = [
  "fake",
  "youtube",
  "podcast-rss",
  "article-rss",
  "readlang-links",
  "custom",
] as const;

export const sourceKinds = [
  "video-channel",
  "podcast-feed",
  "article-feed",
  "article-site",
] as const;

export const contentCandidateTypes = ["video", "podcast", "article"] as const;

const jsonRecordSchema = z.record(z.string(), z.unknown());
const stableKeySchema = z.string().trim().min(3).max(160).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const registerContentSourceSchema = z.strictObject({
  id: z.uuid(),
  stableKey: stableKeySchema,
  adapterType: z.enum(sourceAdapterTypes),
  sourceKind: z.enum(sourceKinds),
  externalSourceId: z.string().trim().min(1).max(500),
  displayName: z.string().trim().min(1).max(200),
  language: z.string().trim().min(2).max(35),
  region: z.string().trim().min(2).max(35).nullable(),
  enabled: z.boolean(),
  rightsStatus: z.enum(sourceRightsStatuses),
  rightsPolicy: jsonRecordSchema.default({}),
  schedule: jsonRecordSchema.default({}),
  rateLimit: jsonRecordSchema.default({}),
  cursor: z.string().max(2_000).nullable().default(null),
});

export const discoveredContentItemSchema = z.strictObject({
  externalItemId: z.string().trim().min(1).max(500),
  canonicalUrl: z.url().refine((value) => value.startsWith("https://") || value.startsWith("http://")),
  title: z.string().trim().min(1).max(500),
  contentType: z.enum(contentCandidateTypes),
  language: z.string().trim().min(2).max(35),
  publishedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  contentHash: sha256Schema.nullable().default(null),
  metadata: jsonRecordSchema.default({}),
});

export const contentSourcePageSchema = z.strictObject({
  sourceStableKey: stableKeySchema,
  cursor: z.string().max(2_000).nullable(),
  nextCursor: z.string().max(2_000).nullable(),
  estimatedCostMicros: z.number().int().nonnegative(),
  items: z.array(discoveredContentItemSchema).max(500),
});

export const candidateStateSchema = z.strictObject({
  status: z.enum(candidateStatuses),
  revision: z.number().int().positive(),
  generationId: z.string().min(1).max(160),
});

export const contentWorkflowCandidateQuerySchema = z.strictObject({
  status: z.enum(candidateStatuses).optional(),
  contentType: z.enum(contentCandidateTypes).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const submitCandidateReviewSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  dimension: z.enum(candidateReviewDimensions).exclude(["owner-release"]),
  status: z.enum(candidateReviewStatuses).exclude(["pending"]),
  notes: z.string().trim().max(4_000).nullable().default(null),
});

export const reprocessCandidateSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  notes: z.string().trim().min(1).max(4_000),
});

export const publishCandidateSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  expectedContentHash: sha256Schema,
});

export const archiveCandidateSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
});

export type RegisterContentSourceInput = z.infer<typeof registerContentSourceSchema>;
export type DiscoveredContentItem = z.infer<typeof discoveredContentItemSchema>;
export type ContentSourcePage = z.infer<typeof contentSourcePageSchema>;
export type SourceAdapterType = (typeof sourceAdapterTypes)[number];
export type SourceKind = (typeof sourceKinds)[number];
export type ContentCandidateType = (typeof contentCandidateTypes)[number];
export type SubmitCandidateReviewInput = z.infer<typeof submitCandidateReviewSchema>;
