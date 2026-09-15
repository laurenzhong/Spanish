import { createHash } from "node:crypto";

import { z } from "zod";

import { mediaSegmentSourceKinds } from "@/src/modules/media/domain";
import { mediaArtworkSchema } from "@/src/modules/media/schemas";

const stableKeySchema = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const httpsUrlSchema = z.url().startsWith("https://");

export const podcastCandidateSegmentSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  sourceText: z.string().trim().min(1).max(4_000),
  translation: z.string().trim().min(1).max(4_000).nullable(),
  speaker: z.string().trim().min(1).max(200).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  sourceKind: z.enum(mediaSegmentSourceKinds),
});

export const podcastCandidateDraftSchema = z.strictObject({
  stableKey: stableKeySchema,
  feedUrl: httpsUrlSchema,
  episodeGuid: z.string().trim().min(1).max(500),
  canonicalUrl: httpsUrlSchema,
  enclosureUrl: httpsUrlSchema,
  enclosureUrlHash: hashSchema,
  enclosureMimeType: z.enum(["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "application/ogg"]),
  enclosureByteSize: z.number().int().positive(),
  playbackProvider: z.enum(["podcast-rss", "language-reactor"]).default("podcast-rss"),
  playbackExpiresAt: z.iso.datetime({ offset: true }).nullable(),
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
  license: z.enum(["original", "public_domain", "creative_commons", "licensed"]),
  attribution: z.string().trim().min(1).max(1_000),
  licenseEvidence: httpsUrlSchema,
  copyrightStatus: z.literal("cleared"),
  artwork: mediaArtworkSchema.nullable().default(null),
  transcriptStatus: z.enum(["unavailable", "platform_manual", "platform_auto", "asr"]),
  transcriptUrl: httpsUrlSchema.nullable(),
  segments: z.array(podcastCandidateSegmentSchema).max(500),
  contentHash: hashSchema,
  changeReason: z.string().trim().min(1).max(1_000),
});

export type PodcastCandidateDraft = z.infer<typeof podcastCandidateDraftSchema>;
type PodcastDraftInput = Omit<PodcastCandidateDraft, "contentHash" | "enclosureUrlHash" | "artwork" | "playbackProvider"> & {
  playbackProvider?: PodcastCandidateDraft["playbackProvider"];
  artwork?: PodcastCandidateDraft["artwork"];
};

export function calculatePodcastEnclosureUrlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

export function calculatePodcastCandidateContentHash(input: Omit<PodcastCandidateDraft, "contentHash"> | PodcastCandidateDraft): string {
  return createHash("sha256").update(JSON.stringify(input, (key, value) =>
    ["contentHash", "fetchedAt", "playbackExpiresAt", "changeReason"].includes(key) ? undefined : value)).digest("hex");
}

export function createPodcastCandidateDraft(input: PodcastDraftInput): PodcastCandidateDraft {
  const normalized = podcastCandidateDraftSchema.parse({
    ...input,
    enclosureUrlHash: calculatePodcastEnclosureUrlHash(input.enclosureUrl),
    contentHash: "0".repeat(64),
  });
  if (normalized.playbackExpiresAt && new Date(normalized.playbackExpiresAt).getTime() <= new Date(normalized.fetchedAt).getTime()) {
    throw new Error("Podcast playback expiry must be later than the enclosure validation time.");
  }
  return { ...normalized, contentHash: calculatePodcastCandidateContentHash(normalized) };
}

export function podcastEpisodeStableKey(sourceStableKey: string, episodeGuid: string): string {
  const digest = createHash("sha256").update(`${sourceStableKey}\u0000${episodeGuid}`).digest("hex").slice(0, 24);
  return `podcast.${digest}`;
}
