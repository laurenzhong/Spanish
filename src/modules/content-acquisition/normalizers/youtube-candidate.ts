import { createHash } from "node:crypto";

import { z } from "zod";

import { mediaSegmentSourceKinds } from "@/src/modules/media/domain";
import { mediaArtworkSchema } from "@/src/modules/media/schemas";

const stableKeySchema = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const videoCandidateSegmentSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  sourceText: z.string().trim().min(1).max(4_000),
  translation: z.string().trim().min(1).max(4_000).nullable(),
  speaker: z.string().trim().min(1).max(200).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  sourceKind: z.enum(mediaSegmentSourceKinds),
});

export const videoCandidateDraftSchema = z.strictObject({
  stableKey: stableKeySchema,
  platform: z.literal("youtube"),
  platformVideoId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/u),
  sourceChannelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/u),
  canonicalUrl: z.url().startsWith("https://www.youtube.com/watch?v="),
  embedUrl: z.url().startsWith("https://www.youtube-nocookie.com/embed/"),
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().max(4_000),
  sourceName: z.string().trim().min(1).max(200),
  language: z.literal("es"),
  region: z.string().trim().min(2).max(35).nullable(),
  cefr: z.enum(["A2", "B1"]),
  topics: z.array(stableKeySchema).min(1).max(20),
  durationMs: z.number().int().positive(),
  publicationDate: z.iso.datetime({ offset: true }),
  fetchedAt: z.iso.datetime({ offset: true }),
  license: z.enum(["creative_commons", "licensed"]),
  attribution: z.string().trim().min(1).max(1_000),
  licenseEvidence: z.url().startsWith("https://"),
  copyrightStatus: z.literal("cleared"),
  artwork: mediaArtworkSchema.nullable().default(null),
  captionStatus: z.enum(["unavailable", "platform_manual", "platform_auto", "asr"]),
  segments: z.array(videoCandidateSegmentSchema).max(500),
  contentHash: hashSchema,
  changeReason: z.string().trim().min(1).max(1_000),
});

export type VideoCandidateDraft = z.infer<typeof videoCandidateDraftSchema>;

type DraftWithoutHash = Omit<VideoCandidateDraft, "contentHash" | "artwork"> & { artwork?: VideoCandidateDraft["artwork"] };

export function calculateVideoCandidateContentHash(input: DraftWithoutHash | VideoCandidateDraft): string {
  return createHash("sha256").update(JSON.stringify(input, (key, value) =>
    key === "contentHash" || key === "fetchedAt" || key === "changeReason" ? undefined : value)).digest("hex");
}

export function createVideoCandidateDraft(input: DraftWithoutHash): VideoCandidateDraft {
  const normalized = videoCandidateDraftSchema.parse({ ...input, contentHash: "0".repeat(64) });
  return { ...normalized, contentHash: calculateVideoCandidateContentHash(normalized) };
}
