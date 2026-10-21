import { z } from "zod";
import { mediaProcessingAuthorizationSchema } from "@/src/modules/media-processing/schemas/processing-authorization";

import type { ContentSourceRecord } from "../../repositories";
import { ContentSourceAdapterError } from "../content-source-adapter";
import { YouTubeChannelAdapter } from "./youtube-channel-adapter";
import { youtubeAllowedVideoIdsSchema } from "./youtube-exact-discovery";

const topicSchema = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);

export const youtubeRightsPolicySchema = z.strictObject({
  mediaProcessing: mediaProcessingAuthorizationSchema.optional(),
  allowedVideoIds: youtubeAllowedVideoIdsSchema.optional(),
  contentMode: z.literal("official_embed"),
  license: z.enum(["creative_commons", "licensed"]),
  attribution: z.string().trim().min(1).max(1_000),
  licenseEvidence: z.url().startsWith("https://"),
  cefr: z.enum(["A1", "A2", "B1", "B2"]),
  topics: z.array(topicSchema).min(1).max(20),
  allowedRegions: z.array(z.string().regex(/^[A-Z]{2}$/u)).min(1).max(30),
  minDurationMs: z.number().int().min(1_000).max(3_600_000).default(15_000),
  maxDurationMs: z.number().int().min(15_000).max(43_200_000).default(1_800_000),
  maxFeedBytes: z.number().int().min(1_024).max(2_000_000).default(500_000),
  maxApiBytes: z.number().int().min(1_024).max(5_000_000).default(1_000_000),
});

export function createYouTubeChannelAdapterFromSource(
  source: ContentSourceRecord,
  fetchImpl: typeof fetch = fetch,
  apiKey = process.env.YOUTUBE_DATA_API_KEY ?? "",
): YouTubeChannelAdapter {
  if (
    !source.enabled
    || source.adapterType !== "youtube"
    || source.sourceKind !== "video-channel"
    || source.rightsStatus !== "verified"
    || source.language !== "es"
    || !/^UC[A-Za-z0-9_-]{22}$/u.test(source.externalSourceId)
  ) {
    throw new ContentSourceAdapterError("YouTube requires an enabled, verified Spanish video-channel source.", false);
  }
  if (!apiKey.trim()) {
    throw new ContentSourceAdapterError("The server-side YouTube Data API key is not configured.", false);
  }
  const policy = youtubeRightsPolicySchema.safeParse(source.rightsPolicy ?? {});
  if (!policy.success || policy.data.minDurationMs > policy.data.maxDurationMs) {
    throw new ContentSourceAdapterError("YouTube source rights policy is incomplete or invalid.", false);
  }
  return new YouTubeChannelAdapter({
    fetch: fetchImpl,
    apiKey,
    source: {
      channelId: source.externalSourceId,
      channelName: source.displayName,
      allowedVideoIds: policy.data.allowedVideoIds,
      region: source.region,
      cefr: policy.data.cefr,
      topics: policy.data.topics,
      allowedRegions: policy.data.allowedRegions,
      minDurationMs: policy.data.minDurationMs,
      maxDurationMs: policy.data.maxDurationMs,
      license: policy.data.license,
      attribution: policy.data.attribution,
      licenseEvidence: policy.data.licenseEvidence,
    },
    maxFeedBytes: policy.data.maxFeedBytes,
    maxApiBytes: policy.data.maxApiBytes,
  });
}
