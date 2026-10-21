import type { ContentSourcePage } from "../../schemas";
import { normalizeCandidateUrl } from "../../domain";
import {
  createPodcastCandidateDraft,
  podcastEpisodeStableKey,
  type PodcastCandidateDraft,
} from "../../normalizers";
import { extractPlainTextFragment } from "../articles/article-source-adapter";
import {
  ContentSourceAdapterError,
  type ContentSourceAdapter,
  type ContentSourceDiscoveryInput,
} from "../content-source-adapter";
import { fetchBoundedResourceMetadata } from "../http/bounded-resource-fetch";
import { fetchBoundedText } from "../http/bounded-text-fetch";
import {
  parseXmlFeed,
  xmlChildren,
  xmlFeedEntries,
  xmlFindFirst,
  xmlFirst,
  xmlText,
  type XmlFeedNode,
} from "./xml-feed";
import { parseWebVttSegments } from "@/src/modules/media/domain";
import { suggestRssPodcastSeries } from "../../normalizers/media-series-suggestion";

type PodcastCursor = Readonly<{
  latestPublishedAt: string;
  latestEpisodeGuid: string;
  etag?: string;
  lastModified?: string;
}>;

type PodcastSource = Readonly<{
  feedUrl: string;
  programName: string;
  region: string | null;
  cefr: "A1" | "A2" | "B1" | "B2";
  topics: readonly string[];
  license: PodcastCandidateDraft["license"];
  attribution: string;
  licenseEvidence: string;
  allowedFeedHosts: readonly string[];
  allowedEpisodeHosts: readonly string[];
  allowedAudioHosts: readonly string[];
  allowedTranscriptHosts: readonly string[];
  allowedAudioMimeTypes?: readonly PodcastCandidateDraft["enclosureMimeType"][];
  transcriptSourceKind: "platform_manual" | "platform_auto";
  minDurationMs?: number;
  maxDurationMs?: number;
  maxFeedBytes?: number;
  maxEnclosureBytes: number;
  maxTranscriptBytes?: number;
  playbackValidityHours: number;
}>;

function parseCursor(value: string | null): PodcastCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.latestPublishedAt !== "string"
      || Number.isNaN(new Date(parsed.latestPublishedAt).getTime())
      || typeof parsed.latestEpisodeGuid !== "string"
    ) throw new Error();
    return {
      latestPublishedAt: new Date(parsed.latestPublishedAt).toISOString(),
      latestEpisodeGuid: parsed.latestEpisodeGuid,
      ...(typeof parsed.etag === "string" ? { etag: parsed.etag } : {}),
      ...(typeof parsed.lastModified === "string" ? { lastModified: parsed.lastModified } : {}),
    };
  } catch {
    throw new ContentSourceAdapterError("Podcast feed cursor is invalid.", false);
  }
}

function isoTimestamp(value: string): string | null {
  const date = new Date(value);
  return !value || Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function durationMs(value: string): number | null {
  const normalized = value.trim();
  if (/^\d+$/u.test(normalized)) {
    const milliseconds = Number(normalized) * 1_000;
    return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : null;
  }
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d{1,2}$/u.test(part))) return null;
  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (seconds > 59 || minutes > 59) return null;
  const milliseconds = ((hours * 60 + minutes) * 60 + seconds) * 1_000;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

function episodeUrl(entry: XmlFeedNode): string {
  const link = xmlChildren(entry, "link").find((node) => {
    const rel = node.attributes.rel?.toLowerCase();
    return !rel || rel === "alternate";
  });
  return link?.attributes.href ?? xmlText(link);
}

function safeEpisodeUrl(raw: string, allowedHosts: readonly string[]): string | null {
  try {
    const normalized = normalizeCandidateUrl(raw);
    const url = new URL(normalized);
    if (url.protocol !== "https:" || url.username || url.password || !allowedHosts.includes(url.hostname.toLowerCase())) return null;
    return normalized;
  } catch {
    return null;
  }
}

async function transcriptSegments(
  entry: XmlFeedNode,
  duration: number,
  options: Readonly<{ fetch: typeof fetch; source: PodcastSource; signal?: AbortSignal }>,
): Promise<Readonly<{ status: PodcastCandidateDraft["transcriptStatus"]; url: string | null; segments: PodcastCandidateDraft["segments"] }>> {
  const transcript = xmlChildren(entry, "transcript").find((node) => {
    const language = node.attributes.language ?? node.attributes.lang;
    const type = node.attributes.type?.split(";", 1)[0]?.trim().toLowerCase();
    return type === "text/vtt" && (!language || /^es(?:-|$)/iu.test(language));
  });
  const rawUrl = transcript?.attributes.url;
  if (!rawUrl || options.source.allowedTranscriptHosts.length === 0) {
    return { status: "unavailable", url: null, segments: [] };
  }
  try {
    const response = await fetchBoundedText({
      url: rawUrl,
      fetch: options.fetch,
      allowedHosts: options.source.allowedTranscriptHosts,
      allowedContentTypes: ["text/vtt"],
      maxBytes: options.source.maxTranscriptBytes ?? 1_000_000,
      signal: options.signal,
    });
    const segments = parseWebVttSegments(response.text, {
      sourceKind: options.source.transcriptSourceKind,
      durationMs: duration,
    });
    return { status: options.source.transcriptSourceKind, url: response.url, segments };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof ContentSourceAdapterError && error.retryable) throw error;
    return { status: "unavailable", url: null, segments: [] };
  }
}

export class PodcastRssAdapter implements ContentSourceAdapter {
  readonly key = "podcast-rss" as const;

  constructor(private readonly options: Readonly<{
    fetch: typeof fetch;
    source: PodcastSource;
    now?: () => Date;
  }>) {}

  async discover(
    input: ContentSourceDiscoveryInput,
    requestOptions?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ContentSourcePage> {
    requestOptions?.signal?.throwIfAborted();
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
      throw new ContentSourceAdapterError("Podcast discovery limit is outside the supported range.", false);
    }
    if (input.externalSourceId !== this.options.source.feedUrl) {
      throw new ContentSourceAdapterError("Podcast feed identity does not match its registered source.", false);
    }
    const cursor = parseCursor(input.cursor);
    const headers = new Headers({ accept: "application/rss+xml, application/xml, text/xml" });
    if (cursor?.etag) headers.set("if-none-match", cursor.etag);
    if (cursor?.lastModified) headers.set("if-modified-since", cursor.lastModified);
    const feed = await fetchBoundedText({
      url: this.options.source.feedUrl,
      fetch: this.options.fetch,
      allowedHosts: this.options.source.allowedFeedHosts,
      allowedContentTypes: ["application/rss+xml", "application/xml", "text/xml"],
      maxBytes: this.options.source.maxFeedBytes ?? 1_000_000,
      headers,
      signal: requestOptions?.signal,
    });
    requestOptions?.signal?.throwIfAborted();
    if (feed.status === 304) {
      return { sourceStableKey: input.sourceStableKey, cursor: input.cursor, nextCursor: input.cursor, estimatedCostMicros: 0, items: [] };
    }

    const document = parseXmlFeed(feed.text);
    const channel = xmlFindFirst(document, "channel");
    const declaredLanguage = xmlText(channel ? xmlFirst(channel, "language") : null);
    if (declaredLanguage && !/^es(?:-|$)/iu.test(declaredLanguage)) {
      return { sourceStableKey: input.sourceStableKey, cursor: input.cursor, nextCursor: input.cursor, estimatedCostMicros: 0, items: [] };
    }
    const parsedEntries = xmlFeedEntries(document).map((entry) => ({
      entry,
      guid: xmlText(xmlFirst(entry, "guid", "id")),
      publishedAt: isoTimestamp(xmlText(xmlFirst(entry, "pubdate", "published", "updated"))),
    })).filter((item): item is typeof item & { guid: string; publishedAt: string } => Boolean(item.guid && item.publishedAt));
    const newest = [...parsedEntries].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || right.guid.localeCompare(left.guid))[0];
    const nextCursor = newest ? JSON.stringify({
      latestPublishedAt: newest.publishedAt,
      latestEpisodeGuid: newest.guid,
      ...(feed.headers.get("etag") ? { etag: feed.headers.get("etag")! } : {}),
      ...(feed.headers.get("last-modified") ? { lastModified: feed.headers.get("last-modified")! } : {}),
    }) : input.cursor;

    const seenGuids = new Set<string>();
    const seenUrls = new Set<string>();
    const items: ContentSourcePage["items"][number][] = [];
    for (const item of parsedEntries) {
      if (items.length >= input.limit) break;
      if (
        seenGuids.has(item.guid)
        || (cursor && (item.publishedAt < cursor.latestPublishedAt
          || (item.publishedAt === cursor.latestPublishedAt && item.guid === cursor.latestEpisodeGuid)))
      ) continue;
      const canonicalUrl = safeEpisodeUrl(episodeUrl(item.entry), this.options.source.allowedEpisodeHosts);
      const title = extractPlainTextFragment(xmlText(xmlFirst(item.entry, "title")));
      const duration = durationMs(xmlText(xmlFirst(item.entry, "duration")));
      const enclosure = xmlFirst(item.entry, "enclosure");
      const enclosureUrl = enclosure?.attributes.url;
      const enclosureType = enclosure?.attributes.type?.split(";", 1)[0]?.trim().toLowerCase();
      const declaredBytes = Number(enclosure?.attributes.length);
      if (
        !canonicalUrl
        || seenUrls.has(canonicalUrl)
        || !title
        || !duration
        || duration < (this.options.source.minDurationMs ?? 15_000)
        || duration > (this.options.source.maxDurationMs ?? 3_600_000)
        || !enclosureUrl
        || !enclosureType
        || !(this.options.source.allowedAudioMimeTypes ?? ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "application/ogg"]).includes(enclosureType as PodcastCandidateDraft["enclosureMimeType"])
        || !Number.isSafeInteger(declaredBytes)
        || declaredBytes <= 0
        || declaredBytes > this.options.source.maxEnclosureBytes
      ) continue;

      try {
        const audio = await fetchBoundedResourceMetadata({
          url: enclosureUrl,
          fetch: this.options.fetch,
          allowedHosts: this.options.source.allowedAudioHosts,
          allowedContentTypes: this.options.source.allowedAudioMimeTypes ?? ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "application/ogg"],
          maxBytes: this.options.source.maxEnclosureBytes,
          signal: requestOptions?.signal,
        });
        requestOptions?.signal?.throwIfAborted();
        if (audio.contentType !== enclosureType) continue;
        const transcript = await transcriptSegments(item.entry, duration, {
          fetch: this.options.fetch,
          source: this.options.source,
          signal: requestOptions?.signal,
        });
        requestOptions?.signal?.throwIfAborted();
        const fetchedAt = (this.options.now ?? (() => new Date()))();
        const draft = createPodcastCandidateDraft({
          stableKey: podcastEpisodeStableKey(input.sourceStableKey, item.guid),
          feedUrl: this.options.source.feedUrl,
          episodeGuid: item.guid,
          canonicalUrl,
          enclosureUrl: audio.url,
          enclosureMimeType: audio.contentType as PodcastCandidateDraft["enclosureMimeType"],
          enclosureByteSize: audio.contentLength,
          playbackExpiresAt: new Date(fetchedAt.getTime() + this.options.source.playbackValidityHours * 3_600_000).toISOString(),
          title,
          summary: extractPlainTextFragment(xmlText(xmlFirst(item.entry, "description", "summary", "content"))).slice(0, 4_000),
          sourceName: this.options.source.programName,
          language: "es",
          region: this.options.source.region,
          cefr: this.options.source.cefr,
          topics: [...this.options.source.topics],
          durationMs: duration,
          publicationDate: item.publishedAt,
          fetchedAt: fetchedAt.toISOString(),
          license: this.options.source.license,
          attribution: this.options.source.attribution,
          licenseEvidence: this.options.source.licenseEvidence,
          copyrightStatus: "cleared",
          transcriptStatus: transcript.status,
          transcriptUrl: transcript.url,
          segments: transcript.segments,
          changeReason: "Published from a reviewed podcast RSS candidate using its verified enclosure.",
        });
        seenGuids.add(item.guid);
        seenUrls.add(canonicalUrl);
        const seriesSuggestion = suggestRssPodcastSeries({
          sourceStableKey: input.sourceStableKey,
          mediaStableKey: draft.stableKey,
          feedUrl: this.options.source.feedUrl,
          registeredProgramName: this.options.source.programName,
          channelTitles: channel ? xmlChildren(channel, "title").map(xmlText) : [],
          seasons: item.entry.children.filter((node) => node.name.toLowerCase() === "itunes:season").map(xmlText),
          episodes: item.entry.children.filter((node) => node.name.toLowerCase() === "itunes:episode").map(xmlText),
        });
        items.push({
          externalItemId: item.guid,
          canonicalUrl,
          title: draft.title,
          contentType: "podcast",
          language: "es",
          publishedAt: draft.publicationDate,
          contentHash: draft.contentHash,
          metadata: { podcastDraft: draft, mediaSeriesSuggestions: seriesSuggestion ? [seriesSuggestion] : [] },
        });
      } catch (error) {
        if (requestOptions?.signal?.aborted) throw error;
        if (error instanceof ContentSourceAdapterError && error.retryable) throw error;
      }
    }
    return { sourceStableKey: input.sourceStableKey, cursor: input.cursor, nextCursor, estimatedCostMicros: 0, items };
  }
}
