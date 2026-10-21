import { z } from "zod";
import { mediaProcessingAuthorizationSchema } from "@/src/modules/media-processing/schemas/processing-authorization";

import type { ContentSourceRecord } from "../../repositories";
import { ContentSourceAdapterError } from "../content-source-adapter";
import { PodcastRssAdapter } from "../rss/podcast-rss-adapter";

const topicSchema = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const hostSchema = z.string().trim().min(1).max(253);

export const podcastRightsPolicySchema = z.strictObject({
  mediaProcessing: mediaProcessingAuthorizationSchema.optional(),
  contentMode: z.literal("enclosure_playback"),
  license: z.enum(["original", "public_domain", "creative_commons", "licensed"]),
  attribution: z.string().trim().min(1).max(1_000),
  licenseEvidence: z.url().startsWith("https://"),
  allowedFeedHosts: z.array(hostSchema).max(20).default([]),
  allowedEpisodeHosts: z.array(hostSchema).min(1).max(50),
  allowedAudioHosts: z.array(hostSchema).min(1).max(50),
  allowedTranscriptHosts: z.array(hostSchema).max(50).default([]),
  allowedAudioMimeTypes: z.array(z.enum(["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "application/ogg"]))
    .min(1).max(6).default(["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "application/ogg"]),
  transcriptSourceKind: z.enum(["platform_manual", "platform_auto"]).default("platform_auto"),
  cefr: z.enum(["A1", "A2", "B1", "B2"]),
  topics: z.array(topicSchema).min(1).max(20),
  minDurationMs: z.number().int().min(1_000).max(3_600_000).default(15_000),
  maxDurationMs: z.number().int().min(15_000).max(43_200_000).default(3_600_000),
  maxFeedBytes: z.number().int().min(1_024).max(5_000_000).default(1_000_000),
  maxEnclosureBytes: z.number().int().min(1).max(1_000_000_000),
  maxTranscriptBytes: z.number().int().min(1_024).max(5_000_000).default(1_000_000),
  playbackValidityHours: z.number().int().min(1).max(720).default(168),
});

export function createPodcastRssAdapterFromSource(
  source: ContentSourceRecord,
  fetchImpl: typeof fetch = fetch,
): PodcastRssAdapter {
  if (
    !source.enabled
    || source.adapterType !== "podcast-rss"
    || source.sourceKind !== "podcast-feed"
    || source.rightsStatus !== "verified"
    || source.language !== "es"
  ) {
    throw new ContentSourceAdapterError("Podcast RSS requires an enabled, verified Spanish podcast-feed source.", false);
  }
  let feedUrl: URL;
  try {
    feedUrl = new URL(source.externalSourceId);
  } catch {
    throw new ContentSourceAdapterError("Podcast feed URL is invalid.", false);
  }
  if (feedUrl.protocol !== "https:" || feedUrl.username || feedUrl.password) {
    throw new ContentSourceAdapterError("Podcast feed URL must be credential-free HTTPS.", false);
  }
  const policy = podcastRightsPolicySchema.safeParse(source.rightsPolicy ?? {});
  if (!policy.success || policy.data.minDurationMs > policy.data.maxDurationMs) {
    throw new ContentSourceAdapterError("Podcast source rights policy is incomplete or invalid.", false);
  }
  return new PodcastRssAdapter({
    fetch: fetchImpl,
    source: {
      feedUrl: feedUrl.toString(),
      programName: source.displayName,
      region: source.region,
      ...policy.data,
      allowedFeedHosts: [...new Set([feedUrl.hostname.toLowerCase(), ...policy.data.allowedFeedHosts.map((host) => host.toLowerCase())])],
      allowedEpisodeHosts: [...new Set(policy.data.allowedEpisodeHosts.map((host) => host.toLowerCase()))],
      allowedAudioHosts: [...new Set(policy.data.allowedAudioHosts.map((host) => host.toLowerCase()))],
      allowedTranscriptHosts: [...new Set(policy.data.allowedTranscriptHosts.map((host) => host.toLowerCase()))],
    },
  });
}
