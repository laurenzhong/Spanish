import { SaxesParser } from "saxes";
import { z } from "zod";

import type { ContentSourcePage } from "../../schemas";
import { createVideoCandidateDraft } from "../../normalizers";
import {
  ContentSourceAdapterError,
  type ContentSourceAdapter,
  type ContentSourceDiscoveryInput,
} from "../content-source-adapter";
import { fetchBoundedText } from "../http/bounded-text-fetch";

type XmlNode = { name: string; text: string; attributes: Record<string, string>; children: XmlNode[] };
type FeedVideo = Readonly<{ videoId: string; title: string; publishedAt: string }>;
type YouTubeCursor = Readonly<{ latestPublishedAt: string; latestVideoId: string; etag?: string; lastModified?: string }>;

const videoDetailsSchema = z.strictObject({
  items: z.array(z.strictObject({
    id: z.string(),
    snippet: z.strictObject({
      channelId: z.string(),
      channelTitle: z.string(),
      title: z.string(),
      description: z.string().default(""),
      publishedAt: z.iso.datetime({ offset: true }),
      defaultAudioLanguage: z.string().optional(),
      defaultLanguage: z.string().optional(),
    }).passthrough(),
    contentDetails: z.strictObject({
      duration: z.string(),
      regionRestriction: z.strictObject({
        allowed: z.array(z.string()).optional(),
        blocked: z.array(z.string()).optional(),
      }).optional(),
    }).passthrough(),
    status: z.strictObject({
      privacyStatus: z.string(),
      embeddable: z.boolean(),
      license: z.string().optional(),
    }).passthrough(),
  }).passthrough()).max(50),
}).passthrough();

function localName(value: string): string {
  return value.toLowerCase().split(":").at(-1) ?? value.toLowerCase();
}

function nodeText(node: XmlNode | undefined): string {
  if (!node) return "";
  return `${node.text} ${node.children.map((child) => nodeText(child)).join(" ")}`.replace(/\s+/gu, " ").trim();
}

function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((candidate) => localName(candidate.name) === name);
}

function parseFeed(xml: string): FeedVideo[] {
  const root: XmlNode = { name: "#document", text: "", attributes: {}, children: [] };
  const stack = [root];
  const parser = new SaxesParser({ xmlns: false });
  let parseError: Error | null = null;
  parser.on("doctype", () => { parseError = new Error("DOCTYPE is not allowed."); });
  parser.on("error", (error) => { parseError = error; });
  parser.on("opentag", (tag) => {
    const node: XmlNode = {
      name: tag.name,
      text: "",
      attributes: Object.fromEntries(Object.entries(tag.attributes).map(([key, value]) => [key, String(value)])),
      children: [],
    };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  parser.on("text", (value) => { stack.at(-1)!.text += value; });
  parser.on("cdata", (value) => { stack.at(-1)!.text += value; });
  parser.on("closetag", () => { if (stack.length > 1) stack.pop(); });
  try {
    parser.write(xml).close();
  } catch (error) {
    parseError = error instanceof Error ? error : new Error("Feed XML is invalid.");
  }
  if (parseError) throw new ContentSourceAdapterError(`YouTube feed XML is invalid: ${parseError.message}`, false);
  const entries: XmlNode[] = [];
  const queue = [...root.children];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (localName(current.name) === "entry") entries.push(current);
    else queue.push(...current.children);
  }
  const seen = new Set<string>();
  const result: FeedVideo[] = [];
  for (const entry of entries) {
    const videoId = nodeText(child(entry, "videoid"));
    const title = nodeText(child(entry, "title"));
    const publishedRaw = nodeText(child(entry, "published"));
    const published = new Date(publishedRaw);
    if (!/^[A-Za-z0-9_-]{6,64}$/u.test(videoId) || !title || Number.isNaN(published.getTime()) || seen.has(videoId)) continue;
    seen.add(videoId);
    result.push({ videoId, title, publishedAt: published.toISOString() });
  }
  return result;
}

function parseCursor(value: string | null): YouTubeCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.latestPublishedAt !== "string"
      || Number.isNaN(new Date(parsed.latestPublishedAt).getTime())
      || typeof parsed.latestVideoId !== "string"
    ) throw new Error();
    return {
      latestPublishedAt: new Date(parsed.latestPublishedAt).toISOString(),
      latestVideoId: parsed.latestVideoId,
      ...(typeof parsed.etag === "string" ? { etag: parsed.etag } : {}),
      ...(typeof parsed.lastModified === "string" ? { lastModified: parsed.lastModified } : {}),
    };
  } catch {
    throw new ContentSourceAdapterError("YouTube channel cursor is invalid.", false);
  }
}

function durationMs(value: string): number | null {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/u.exec(value);
  if (!match) return null;
  const milliseconds = ((((Number(match[1] ?? 0) * 24) + Number(match[2] ?? 0)) * 60 + Number(match[3] ?? 0)) * 60 + Number(match[4] ?? 0)) * 1_000;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

function availableInConfiguredRegion(
  restriction: { allowed?: string[]; blocked?: string[] } | undefined,
  configured: readonly string[],
): boolean {
  if (!restriction) return true;
  const allowed = new Set(restriction.allowed ?? []);
  const blocked = new Set(restriction.blocked ?? []);
  return configured.some((region) => (allowed.size === 0 || allowed.has(region)) && !blocked.has(region));
}

export class YouTubeChannelAdapter implements ContentSourceAdapter {
  readonly key = "youtube" as const;

  constructor(private readonly options: Readonly<{
    fetch: typeof fetch;
    apiKey: string;
    source: Readonly<{
      channelId: string;
      channelName: string;
      region: string | null;
      cefr: "A2" | "B1";
      topics: readonly string[];
      allowedRegions?: readonly string[];
      minDurationMs?: number;
      maxDurationMs?: number;
      license: "creative_commons" | "licensed";
      attribution: string;
      licenseEvidence: string;
    }>;
    maxFeedBytes?: number;
    maxApiBytes?: number;
    now?: () => Date;
  }>) {}

  async discover(input: ContentSourceDiscoveryInput, requestOptions?: Readonly<{ signal?: AbortSignal }>): Promise<ContentSourcePage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new ContentSourceAdapterError("YouTube discovery limit must be between 1 and 50.", false);
    }
    if (input.externalSourceId !== this.options.source.channelId || !this.options.apiKey.trim()) {
      throw new ContentSourceAdapterError("YouTube source identity or server credential is invalid.", false);
    }
    const cursor = parseCursor(input.cursor);
    const headers = new Headers({ accept: "application/atom+xml, application/xml, text/xml" });
    if (cursor?.etag) headers.set("if-none-match", cursor.etag);
    if (cursor?.lastModified) headers.set("if-modified-since", cursor.lastModified);
    const feed = await fetchBoundedText({
      url: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(this.options.source.channelId)}`,
      fetch: this.options.fetch,
      allowedHosts: ["www.youtube.com"],
      allowedContentTypes: ["application/atom+xml", "application/xml", "text/xml"],
      maxBytes: this.options.maxFeedBytes ?? 500_000,
      headers,
      signal: requestOptions?.signal,
    });
    if (feed.status === 304) {
      return { sourceStableKey: input.sourceStableKey, cursor: input.cursor, nextCursor: input.cursor, estimatedCostMicros: 0, items: [] };
    }
    const feedVideos = parseFeed(feed.text)
      .filter((video) => !cursor || video.publishedAt > cursor.latestPublishedAt || (video.publishedAt === cursor.latestPublishedAt && video.videoId !== cursor.latestVideoId))
      .slice(0, input.limit);
    const newest = parseFeed(feed.text)[0];
    const nextCursor = newest ? JSON.stringify({
      latestPublishedAt: newest.publishedAt,
      latestVideoId: newest.videoId,
      ...(feed.headers.get("etag") ? { etag: feed.headers.get("etag")! } : {}),
      ...(feed.headers.get("last-modified") ? { lastModified: feed.headers.get("last-modified")! } : {}),
    }) : input.cursor;
    if (feedVideos.length === 0) {
      return { sourceStableKey: input.sourceStableKey, cursor: input.cursor, nextCursor, estimatedCostMicros: 0, items: [] };
    }
    const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    detailsUrl.searchParams.set("part", "snippet,contentDetails,status");
    detailsUrl.searchParams.set("id", feedVideos.map((video) => video.videoId).join(","));
    detailsUrl.searchParams.set("key", this.options.apiKey);
    const detailsResponse = await fetchBoundedText({
      url: detailsUrl.toString(),
      fetch: this.options.fetch,
      allowedHosts: ["www.googleapis.com"],
      allowedContentTypes: ["application/json"],
      maxBytes: this.options.maxApiBytes ?? 1_000_000,
      signal: requestOptions?.signal,
    });
    let details;
    try {
      details = videoDetailsSchema.parse(JSON.parse(detailsResponse.text));
    } catch {
      throw new ContentSourceAdapterError("YouTube Data API returned an invalid response.", false);
    }
    const feedById = new Map(feedVideos.map((video) => [video.videoId, video]));
    const now = (this.options.now ?? (() => new Date()))().toISOString();
    const items: ContentSourcePage["items"][number][] = [];
    for (const detail of details.items) {
      const feedVideo = feedById.get(detail.id);
      const duration = durationMs(detail.contentDetails.duration);
      const declaredLanguage = detail.snippet.defaultAudioLanguage ?? detail.snippet.defaultLanguage;
      if (
        !feedVideo
        || detail.snippet.channelId !== this.options.source.channelId
        || (declaredLanguage !== undefined && !/^es(?:-|$)/iu.test(declaredLanguage))
        || detail.status.privacyStatus !== "public"
        || !detail.status.embeddable
        || (this.options.source.license === "creative_commons" && detail.status.license !== "creativeCommon")
        || !duration
        || duration < (this.options.source.minDurationMs ?? 1_000)
        || duration > (this.options.source.maxDurationMs ?? 43_200_000)
        || !availableInConfiguredRegion(detail.contentDetails.regionRestriction, this.options.source.allowedRegions ?? ["ES"])
      ) continue;
      const canonicalUrl = `https://www.youtube.com/watch?v=${detail.id}`;
      const draft = createVideoCandidateDraft({
        stableKey: `youtube.${detail.id.toLowerCase()}`,
        platform: "youtube",
        platformVideoId: detail.id,
        sourceChannelId: detail.snippet.channelId,
        canonicalUrl,
        embedUrl: `https://www.youtube-nocookie.com/embed/${detail.id}?enablejsapi=1`,
        title: detail.snippet.title.trim() || feedVideo.title,
        summary: detail.snippet.description.trim().slice(0, 4_000),
        sourceName: detail.snippet.channelTitle.trim() || this.options.source.channelName,
        language: "es",
        region: this.options.source.region,
        cefr: this.options.source.cefr,
        topics: [...this.options.source.topics],
        durationMs: duration,
        publicationDate: new Date(detail.snippet.publishedAt).toISOString(),
        fetchedAt: now,
        license: this.options.source.license,
        attribution: this.options.source.attribution,
        licenseEvidence: this.options.source.licenseEvidence,
        copyrightStatus: "cleared",
        captionStatus: "unavailable",
        segments: [],
        changeReason: "Published from a reviewed YouTube channel candidate using the official embed.",
      });
      items.push({
        externalItemId: detail.id,
        canonicalUrl,
        title: draft.title,
        contentType: "video",
        language: "es",
        publishedAt: draft.publicationDate,
        contentHash: draft.contentHash,
        metadata: { videoDraft: draft },
      });
    }
    return { sourceStableKey: input.sourceStableKey, cursor: input.cursor, nextCursor, estimatedCostMicros: 0, items };
  }
}
