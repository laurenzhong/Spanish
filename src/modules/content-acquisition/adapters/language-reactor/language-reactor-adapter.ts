import { z } from "zod";
import { createHash } from "node:crypto";

import { createPodcastCandidateDraft } from "../../normalizers/podcast-candidate";
import { createVideoCandidateDraft } from "../../normalizers/youtube-candidate";
import type { MediaArtwork } from "@/src/modules/media/domain";
import type { ContentSourceRecord } from "../../repositories";
import type { ContentSourcePage } from "../../schemas";
import { fetchBoundedResourceMetadata } from "../http/bounded-resource-fetch";
import { fetchBoundedText } from "../http/bounded-text-fetch";
import { ContentSourceAdapterError, type ContentSourceAdapter, type ContentSourceDiscoveryInput } from "../content-source-adapter";

const languageReactorDocSchema = z.object({
  mediaClass: z.string(),
  source: z.string(),
  info: z.object({
    videoId: z.string().optional(),
    channelId: z.string().optional(),
    channelName: z.string().optional(),
    feedTitle: z.string().optional(),
    itunesId: z.string().optional(),
  }).passthrough().default({}),
  image: z.object({
    type: z.string().optional(),
    src: z.string().optional(),
  }).passthrough().optional(),
  audioFileURL: z.string().optional(),
  duration_ms: z.number().positive(),
  diocoDocId: z.string().min(1).max(200),
  diocoDocName: z.string().min(1).max(500),
  description: z.string().optional().default(""),
  lang_G: z.string().optional(),
  publishDate: z.object({ type: z.string(), timestamp_unixms: z.number() }).optional(),
}).passthrough();

const languageReactorResponseSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    docs_metadata: z.array(languageReactorDocSchema).max(100),
    paginationApplied: z.boolean().optional(),
  }).passthrough(),
}).passthrough();

const itunesLookupResponseSchema = z.object({
  results: z.array(z.object({
    artworkUrl600: z.string().optional(),
    artworkUrl100: z.string().optional(),
  }).passthrough()).max(20),
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
  authorization: z.string().trim().min(1).max(2_000).optional(),
  cefr: z.enum(["A2", "B1"]),
  topics: z.array(topicSchema).min(1).max(20),
  allowedAudioHosts: z.array(hostSchema).min(1).max(100),
  allowedAudioMimeTypes: z.array(z.enum(["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "application/ogg"]))
    .min(1).max(6),
  minDurationMs: z.number().int().min(1_000).max(3_600_000).default(15_000),
  maxDurationMs: z.number().int().min(15_000).max(43_200_000).default(3_600_000),
  maxApiBytes: z.number().int().min(1_024).max(5_000_000).default(5_000_000),
  maxEnclosureBytes: z.number().int().min(1).max(1_000_000_000),
  playbackValidityHours: z.number().int().min(1).max(720).nullable().default(168),
});

type LanguageReactorPolicy = z.infer<typeof languageReactorRightsPolicySchema>;

function parseCursor(value: string | null): number {
  if (!value) return 0;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new ContentSourceAdapterError("Language Reactor cursor is invalid.", false);
  }
  const parsed = cursorSchema.safeParse(raw);
  if (!parsed.success) throw new ContentSourceAdapterError("Language Reactor cursor is invalid.", false);
  return parsed.data.offset;
}

function publicationDate(doc: z.infer<typeof languageReactorDocSchema>): string {
  const timestamp = doc.publishDate?.timestamp_unixms;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    const value = new Date(timestamp);
    if (!Number.isNaN(value.getTime())) return value.toISOString();
  }
  return new Date(0).toISOString();
}

function canonicalPodcastUrl(directoryUrl: string, docId: string): string {
  const url = new URL(directoryUrl);
  url.searchParams.set("doc", docId);
  return url.toString();
}

function mediaTab(sourceKind: ContentSourceRecord["sourceKind"]): "TAB_PODCASTS" | "TAB_YOUTUBE" {
  if (sourceKind === "podcast-feed") return "TAB_PODCASTS";
  if (sourceKind === "video-channel") return "TAB_YOUTUBE";
  throw new ContentSourceAdapterError("Language Reactor sources must be video-channel or podcast-feed sources.", false);
}

function youtubeStableKey(videoId: string): string {
  const digest = createHash("sha256").update(videoId).digest("hex").slice(0, 24);
  return `youtube.language-reactor.${digest}`;
}

function httpsArtworkUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export class LanguageReactorAdapter implements ContentSourceAdapter {
  readonly key = "language-reactor" as const;
  private readonly podcastArtworkCache = new Map<string, MediaArtwork | null>();

  constructor(private readonly options: Readonly<{
    fetch: typeof fetch;
    source: Readonly<{
      sourceKind: ContentSourceRecord["sourceKind"];
      playlistId: string;
      directoryUrl: string;
      displayName: string;
      region: string | null;
      policy: LanguageReactorPolicy;
    }>;
    now?: () => Date;
  }>) {}

  private async podcastArtwork(
    itunesId: string | undefined,
    alt: string,
    signal?: AbortSignal,
  ) {
    if (!itunesId) return null;
    const cached = this.podcastArtworkCache.get(itunesId);
    if (cached !== undefined) return cached;
    try {
      const response = await fetchBoundedText({
        url: `https://itunes.apple.com/lookup?entity=podcast&id=${encodeURIComponent(itunesId)}`,
        fetch: this.options.fetch,
        allowedHosts: ["itunes.apple.com"],
        allowedContentTypes: ["application/json", "text/javascript"],
        maxBytes: 100_000,
        signal,
      });
      const parsed = itunesLookupResponseSchema.parse(JSON.parse(response.text));
      const url = httpsArtworkUrl(parsed.results[0]?.artworkUrl600 ?? parsed.results[0]?.artworkUrl100);
      const artwork = url ? { url, alt: alt.slice(0, 300), source: "podcast-feed" as const, width: 600, height: 600, expiresAt: null } : null;
      this.podcastArtworkCache.set(itunesId, artwork);
      return artwork;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof ContentSourceAdapterError && error.retryable) throw error;
      this.podcastArtworkCache.set(itunesId, null);
      return null;
    }
  }

  async discover(input: ContentSourceDiscoveryInput, requestOptions?: Readonly<{ signal?: AbortSignal }>): Promise<ContentSourcePage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new ContentSourceAdapterError("Language Reactor discovery limit must be between 1 and 100.", false);
    }
    const offset = parseCursor(input.cursor);
    const policy = this.options.source.policy;
    const body = JSON.stringify({
      userEmail: null,
      diocoToken: null,
      translationLang_G: "zh-CN",
      freq95: { min: 0, max: 100_000 },
      lang_G: "es",
      filters: { mediaTab: mediaTab(this.options.source.sourceKind) },
      pinnedDiocoPlaylistIds: [],
      selectedDiocoPlaylistId: this.options.source.playlistId,
      diocoPlaylistId: this.options.source.playlistId,
      forceIncludeDiocoDocId: null,
      offset,
      limit: input.limit,
    });
    const response = await fetchBoundedText({
      url: "https://api-cdn.dioco.io/base_media_getMediaDocs_5",
      fetch: this.options.fetch,
      method: "POST",
      body,
      headers: { "content-type": "application/json", accept: "application/json" },
      allowedHosts: [policy.apiHost],
      allowedContentTypes: ["application/json"],
      maxBytes: policy.maxApiBytes,
      signal: requestOptions?.signal,
    });
    let parsed;
    try {
      parsed = languageReactorResponseSchema.parse(JSON.parse(response.text));
    } catch {
      throw new ContentSourceAdapterError("Language Reactor media API returned an invalid response.", false);
    }
    const fetchedAt = (this.options.now ?? (() => new Date()))();
    const items: ContentSourcePage["items"][number][] = [];
    for (const doc of parsed.data.docs_metadata) {
      if (doc.lang_G && !/^es(?:-|$)/iu.test(doc.lang_G)) continue;
      if (doc.duration_ms < policy.minDurationMs || doc.duration_ms > policy.maxDurationMs) continue;
      const publishedAt = publicationDate(doc);
      if (this.options.source.sourceKind === "video-channel") {
        const videoId = doc.info.videoId;
        const channelId = doc.info.channelId;
        if (doc.mediaClass !== "YOUTUBE" || !videoId || !channelId || !/^UC[A-Za-z0-9_-]{22}$/u.test(channelId)) continue;
        const title = doc.diocoDocName.trim();
        const draft = createVideoCandidateDraft({
          stableKey: youtubeStableKey(videoId),
          platform: "youtube",
          platformVideoId: videoId,
          sourceChannelId: channelId,
          canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
          embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1`,
          title,
          summary: doc.description.trim().slice(0, 4_000),
          sourceName: doc.info.channelName?.trim() || this.options.source.displayName,
          language: "es",
          region: this.options.source.region,
          cefr: policy.cefr,
          topics: [...policy.topics],
          durationMs: doc.duration_ms,
          publicationDate: publishedAt,
          fetchedAt: fetchedAt.toISOString(),
          license: policy.license,
          attribution: policy.attribution,
          licenseEvidence: policy.licenseEvidence,
          copyrightStatus: "cleared",
          artwork: {
            url: httpsArtworkUrl(doc.image?.src) ?? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/maxresdefault.jpg`,
            alt: title.slice(0, 300),
            source: "youtube",
            width: 1280,
            height: 720,
            expiresAt: null,
          },
          captionStatus: "unavailable",
          segments: [],
          changeReason: "Discovered from the owner-authorized Language Reactor YouTube directory.",
        });
        items.push({ externalItemId: videoId, canonicalUrl: draft.canonicalUrl, title, contentType: "video", language: "es", publishedAt, contentHash: draft.contentHash, metadata: { videoDraft: draft } });
        continue;
      }

      const audioUrl = doc.audioFileURL;
      if (doc.mediaClass !== "AUDIO_FILE" || !audioUrl) continue;
      try {
        const audio = await fetchBoundedResourceMetadata({
          url: audioUrl,
          fetch: this.options.fetch,
          allowedHosts: policy.allowedAudioHosts,
          allowedContentTypes: policy.allowedAudioMimeTypes,
          maxBytes: policy.maxEnclosureBytes,
          signal: requestOptions?.signal,
        });
        const title = doc.diocoDocName.trim();
        const artwork = await this.podcastArtwork(doc.info.itunesId, doc.info.feedTitle?.trim() || title, requestOptions?.signal);
        const draft = createPodcastCandidateDraft({
          stableKey: `podcast.language-reactor.${doc.diocoDocId.toLowerCase()}`,
          feedUrl: this.options.source.directoryUrl,
          episodeGuid: doc.diocoDocId,
          canonicalUrl: canonicalPodcastUrl(this.options.source.directoryUrl, doc.diocoDocId),
          enclosureUrl: audio.url,
          enclosureMimeType: audio.contentType as "audio/mpeg" | "audio/mp4" | "audio/aac" | "audio/ogg" | "audio/webm" | "application/ogg",
          enclosureByteSize: audio.contentLength,
          playbackProvider: "language-reactor",
          playbackExpiresAt: policy.playbackValidityHours === null
            ? null
            : new Date(fetchedAt.getTime() + policy.playbackValidityHours * 3_600_000).toISOString(),
          title,
          summary: doc.description.trim().slice(0, 4_000),
          sourceName: doc.info.feedTitle?.trim() || this.options.source.displayName,
          language: "es",
          region: this.options.source.region,
          cefr: policy.cefr,
          topics: [...policy.topics],
          durationMs: doc.duration_ms,
          publicationDate: publishedAt,
          fetchedAt: fetchedAt.toISOString(),
          license: policy.license,
          attribution: policy.attribution,
          licenseEvidence: policy.licenseEvidence,
          copyrightStatus: "cleared",
          artwork,
          transcriptStatus: "unavailable",
          transcriptUrl: null,
          segments: [],
          changeReason: "Discovered from the owner-authorized Language Reactor podcast directory.",
        });
        items.push({ externalItemId: doc.diocoDocId, canonicalUrl: draft.canonicalUrl, title, contentType: "podcast", language: "es", publishedAt, contentHash: draft.contentHash, metadata: { podcastDraft: draft } });
      } catch (error) {
        if (requestOptions?.signal?.aborted) throw error;
        if (error instanceof ContentSourceAdapterError && error.retryable) throw error;
      }
    }
    const nextOffset = offset + input.limit;
    const nextCursor = parsed.data.docs_metadata.length >= input.limit ? JSON.stringify({ offset: nextOffset }) : null;
    return { sourceStableKey: input.sourceStableKey, cursor: input.cursor, nextCursor, estimatedCostMicros: 0, items };
  }
}
