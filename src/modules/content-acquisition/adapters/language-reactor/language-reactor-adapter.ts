import { createHash } from "node:crypto";

import { z } from "zod";

import { createPodcastCandidateDraft } from "../../normalizers/podcast-candidate";
import { createVideoCandidateDraft } from "../../normalizers/youtube-candidate";
import type { ContentSourceRecord } from "../../repositories";
import type { ContentSourcePage } from "../../schemas";
import { fetchBoundedResourceMetadata } from "../http/bounded-resource-fetch";
import { fetchBoundedText } from "../http/bounded-text-fetch";
import { ContentSourceAdapterError, type ContentSourceAdapter, type ContentSourceDiscoveryInput } from "../content-source-adapter";

const documentSchema = z.object({
  mediaClass: z.string(),
  info: z.object({
    videoId: z.string().optional(),
    channelId: z.string().optional(),
    channelName: z.string().optional(),
    feedTitle: z.string().optional(),
  }).passthrough().default({}),
  audioFileURL: z.string().optional(),
  duration_ms: z.number().positive(),
  diocoDocId: z.string().min(1).max(200),
  diocoDocName: z.string().min(1).max(500),
  description: z.string().optional().default(""),
  lang_G: z.string().optional(),
  publishDate: z.object({ timestamp_unixms: z.number() }).passthrough().optional(),
}).passthrough();

const responseSchema = z.object({
  status: z.literal("success"),
  data: z.object({ docs_metadata: z.array(documentSchema).max(100) }).passthrough(),
}).passthrough();

const cursorSchema = z.object({ offset: z.number().int().nonnegative() });
const hostSchema = z.string().trim().min(1).max(253);
const topicSchema = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);

export const languageReactorRightsPolicySchema = z.strictObject({
  provider: z.literal("language-reactor"),
  directoryUrl: z.url().startsWith("https://"),
  apiHost: z.literal("api-cdn.dioco.io").default("api-cdn.dioco.io"),
  license: z.literal("licensed"),
  attribution: z.string().trim().min(1).max(1_000),
  licenseEvidence: z.url().startsWith("https://"),
  cefr: z.enum(["A2", "B1"]),
  topics: z.array(topicSchema).min(1).max(20),
  allowedAudioHosts: z.array(hostSchema).min(1).max(100),
  allowedAudioMimeTypes: z.array(z.enum(["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "application/ogg"])).min(1).max(6),
  minDurationMs: z.number().int().min(1_000).max(3_600_000).default(15_000),
  maxDurationMs: z.number().int().min(15_000).max(43_200_000).default(3_600_000),
  maxApiBytes: z.number().int().min(1_024).max(5_000_000).default(5_000_000),
  maxEnclosureBytes: z.number().int().min(1).max(1_000_000_000),
  playbackValidityHours: z.number().int().min(1).max(720).nullable().default(168),
});

type LanguageReactorPolicy = z.infer<typeof languageReactorRightsPolicySchema>;

function parseCursor(value: string | null): number {
  if (!value) return 0;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data.offset;
  } catch {
    // The adapter intentionally exposes only a stable, non-sensitive cursor error.
  }
  throw new ContentSourceAdapterError("Language Reactor cursor is invalid.", false);
}

function publicationDate(document: z.infer<typeof documentSchema>): string {
  const timestamp = document.publishDate?.timestamp_unixms;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date(0).toISOString();
}

function mediaTab(sourceKind: ContentSourceRecord["sourceKind"]): "TAB_PODCASTS" | "TAB_YOUTUBE" {
  if (sourceKind === "podcast-feed") return "TAB_PODCASTS";
  if (sourceKind === "video-channel") return "TAB_YOUTUBE";
  throw new ContentSourceAdapterError("Language Reactor source kind is invalid.", false);
}

function videoStableKey(videoId: string): string {
  return `youtube.language-reactor.${createHash("sha256").update(videoId).digest("hex").slice(0, 24)}`;
}

export class LanguageReactorAdapter implements ContentSourceAdapter {
  readonly key = "language-reactor" as const;

  constructor(private readonly options: Readonly<{
    fetch: typeof fetch;
    source: Readonly<{
      sourceKind: "video-channel" | "podcast-feed";
      playlistId: string;
      displayName: string;
      region: string | null;
      policy: LanguageReactorPolicy;
    }>;
    now?: () => Date;
  }>) {}

  async discover(input: ContentSourceDiscoveryInput, requestOptions?: Readonly<{ signal?: AbortSignal }>): Promise<ContentSourcePage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new ContentSourceAdapterError("Language Reactor discovery limit must be between 1 and 50.", false);
    }
    const offset = parseCursor(input.cursor);
    const policy = this.options.source.policy;
    const response = await fetchBoundedText({
      url: "https://api-cdn.dioco.io/base_media_getMediaDocs_5",
      fetch: this.options.fetch,
      method: "POST",
      body: JSON.stringify({
        userEmail: null,
        diocoToken: null,
        translationLang_G: "zh-CN",
        lang_G: "es",
        filters: { mediaTab: mediaTab(this.options.source.sourceKind) },
        selectedDiocoPlaylistId: this.options.source.playlistId,
        diocoPlaylistId: this.options.source.playlistId,
        offset,
        limit: input.limit,
      }),
      headers: { "content-type": "application/json", accept: "application/json" },
      allowedHosts: [policy.apiHost],
      allowedContentTypes: ["application/json"],
      maxBytes: policy.maxApiBytes,
      signal: requestOptions?.signal,
    });
    let documents: z.infer<typeof documentSchema>[];
    try {
      documents = responseSchema.parse(JSON.parse(response.text)).data.docs_metadata;
    } catch {
      throw new ContentSourceAdapterError("Language Reactor media API returned an invalid response.", false);
    }
    const fetchedAt = (this.options.now ?? (() => new Date()))();
    const items: ContentSourcePage["items"][number][] = [];
    for (const document of documents) {
      if (document.lang_G && !/^es(?:-|$)/iu.test(document.lang_G)) continue;
      if (document.duration_ms < policy.minDurationMs || document.duration_ms > policy.maxDurationMs) continue;
      const title = document.diocoDocName.trim();
      const publishedAt = publicationDate(document);
      if (this.options.source.sourceKind === "video-channel") {
        const videoId = document.info.videoId;
        const channelId = document.info.channelId;
        if (document.mediaClass !== "YOUTUBE" || !videoId || !channelId || !/^UC[A-Za-z0-9_-]{22}$/u.test(channelId)) continue;
        const draft = createVideoCandidateDraft({
          stableKey: videoStableKey(videoId),
          platform: "youtube",
          platformVideoId: videoId,
          sourceChannelId: channelId,
          canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
          embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1`,
          title,
          summary: document.description.trim().slice(0, 4_000),
          sourceName: document.info.channelName?.trim() || this.options.source.displayName,
          language: "es",
          region: this.options.source.region,
          cefr: policy.cefr,
          topics: [...policy.topics],
          durationMs: document.duration_ms,
          publicationDate: publishedAt,
          fetchedAt: fetchedAt.toISOString(),
          license: policy.license,
          attribution: policy.attribution,
          licenseEvidence: policy.licenseEvidence,
          copyrightStatus: "cleared",
          captionStatus: "unavailable",
          segments: [],
          changeReason: "Discovered from the owner-authorized Language Reactor YouTube directory.",
        });
        items.push({ externalItemId: videoId, canonicalUrl: draft.canonicalUrl, title, contentType: "video", language: "es", publishedAt, contentHash: draft.contentHash, metadata: { videoDraft: draft } });
        continue;
      }
      if (document.mediaClass !== "AUDIO_FILE" || !document.audioFileURL) continue;
      try {
        const audio = await fetchBoundedResourceMetadata({
          url: document.audioFileURL,
          fetch: this.options.fetch,
          allowedHosts: policy.allowedAudioHosts,
          allowedContentTypes: policy.allowedAudioMimeTypes,
          maxBytes: policy.maxEnclosureBytes,
          signal: requestOptions?.signal,
        });
        const draft = createPodcastCandidateDraft({
          stableKey: `podcast.language-reactor.${document.diocoDocId.toLowerCase()}`,
          feedUrl: policy.directoryUrl,
          episodeGuid: document.diocoDocId,
          canonicalUrl: `${policy.directoryUrl}?doc=${encodeURIComponent(document.diocoDocId)}`,
          enclosureUrl: audio.url,
          enclosureMimeType: audio.contentType as "audio/mpeg" | "audio/mp4" | "audio/aac" | "audio/ogg" | "audio/webm" | "application/ogg",
          enclosureByteSize: audio.contentLength,
          playbackExpiresAt: new Date(fetchedAt.getTime() + (policy.playbackValidityHours ?? 168) * 3_600_000).toISOString(),
          title,
          summary: document.description.trim().slice(0, 4_000),
          sourceName: document.info.feedTitle?.trim() || this.options.source.displayName,
          language: "es",
          region: this.options.source.region,
          cefr: policy.cefr,
          topics: [...policy.topics],
          durationMs: document.duration_ms,
          publicationDate: publishedAt,
          fetchedAt: fetchedAt.toISOString(),
          license: policy.license,
          attribution: policy.attribution,
          licenseEvidence: policy.licenseEvidence,
          copyrightStatus: "cleared",
          transcriptStatus: "unavailable",
          transcriptUrl: null,
          segments: [],
          changeReason: "Discovered from the owner-authorized Language Reactor podcast directory.",
        });
        items.push({ externalItemId: document.diocoDocId, canonicalUrl: draft.canonicalUrl, title, contentType: "podcast", language: "es", publishedAt, contentHash: draft.contentHash, metadata: { podcastDraft: draft } });
      } catch (error) {
        if (requestOptions?.signal?.aborted) throw error;
        if (error instanceof ContentSourceAdapterError && error.retryable) throw error;
      }
    }
    return {
      sourceStableKey: input.sourceStableKey,
      cursor: input.cursor,
      nextCursor: documents.length >= input.limit ? JSON.stringify({ offset: offset + input.limit }) : null,
      estimatedCostMicros: 0,
      items,
    };
  }
}
