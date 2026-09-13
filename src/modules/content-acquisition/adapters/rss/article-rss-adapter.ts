import { SaxesParser } from "saxes";

import type { ContentSourcePage } from "../../schemas";
import { normalizeCandidateUrl } from "../../domain";
import { normalizeArticleCandidate, type ArticleCandidateDraft } from "../../normalizers";
import {
  ContentSourceAdapterError,
  type ContentSourceAdapter,
  type ContentSourceDiscoveryInput,
} from "../content-source-adapter";
import { ArticleSourceAdapter, extractPlainTextFragment } from "../articles/article-source-adapter";
import { fetchBoundedText } from "../http/bounded-text-fetch";

type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  text: string;
  children: XmlNode[];
};

type FeedCursor = Readonly<{
  url: string;
  validatorUrl?: string;
  etag?: string;
  lastModified?: string;
}>;

function localName(value: string): string {
  return value.toLowerCase().split(":").at(-1) ?? value.toLowerCase();
}

function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => localName(child.name) === name);
}

function first(node: XmlNode, ...names: string[]): XmlNode | null {
  for (const name of names) {
    const match = children(node, name)[0];
    if (match) return match;
  }
  return null;
}

function text(node: XmlNode | null): string {
  if (!node) return "";
  return `${node.text} ${node.children.map((child) => text(child)).join(" ")}`.replace(/\s+/gu, " ").trim();
}

function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#document", attributes: {}, text: "", children: [] };
  const stack = [root];
  const parser = new SaxesParser({ xmlns: false });
  let parseError: Error | null = null;
  parser.on("doctype", () => {
    parseError = new Error("Document type declarations are not allowed in feeds.");
  });
  parser.on("error", (error) => {
    parseError = error;
  });
  parser.on("opentag", (tag) => {
    const attributes = Object.fromEntries(
      Object.entries(tag.attributes).map(([key, value]) => [key.toLowerCase(), String(value)]),
    );
    const node: XmlNode = { name: tag.name, attributes, text: "", children: [] };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  parser.on("text", (value) => {
    stack.at(-1)!.text += value;
  });
  parser.on("cdata", (value) => {
    stack.at(-1)!.text += value;
  });
  parser.on("closetag", () => {
    if (stack.length > 1) stack.pop();
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    parseError = error instanceof Error ? error : new Error("Feed XML is invalid.");
  }
  if (parseError) throw new ContentSourceAdapterError(`Feed XML is invalid: ${parseError.message}`, false);
  return root;
}

function parseCursor(value: string | null, fallbackUrl: string): FeedCursor {
  if (!value) return { url: fallbackUrl };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.url !== "string") throw new Error();
    return {
      url: parsed.url,
      ...(typeof parsed.validatorUrl === "string" ? { validatorUrl: parsed.validatorUrl } : {}),
      ...(typeof parsed.etag === "string" ? { etag: parsed.etag } : {}),
      ...(typeof parsed.lastModified === "string" ? { lastModified: parsed.lastModified } : {}),
    };
  } catch {
    throw new ContentSourceAdapterError("Article feed cursor is invalid.", false);
  }
}

function elementUrl(node: XmlNode): string {
  const link = children(node, "link").find((candidate) => {
    const rel = candidate.attributes.rel?.toLowerCase();
    return !rel || rel === "alternate";
  });
  return link?.attributes.href ?? text(link ?? null);
}

function nextFeedUrl(document: XmlNode, baseUrl: string): string | null {
  const queue = [...document.children];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (localName(node.name) === "link" && node.attributes.rel?.toLowerCase() === "next") {
      const target = node.attributes.href || text(node);
      return target ? new URL(target, baseUrl).toString() : null;
    }
    queue.push(...node.children);
  }
  return null;
}

function feedEntries(document: XmlNode): XmlNode[] {
  const queue = [...document.children];
  const result: XmlNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    const name = localName(node.name);
    if (name === "item" || name === "entry") result.push(node);
    else queue.push(...node.children);
  }
  return result;
}

function isoTimestamp(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export class ArticleRssAdapter implements ContentSourceAdapter {
  readonly key = "article-rss" as const;

  constructor(private readonly options: Readonly<{
    fetch: typeof fetch;
    allowedHosts: readonly string[];
    pageAdapter: ArticleSourceAdapter;
    source: Readonly<{
      sourceName: string;
      sourceType: ArticleCandidateDraft["sourceType"];
      license: ArticleCandidateDraft["license"];
      attribution: string;
      licenseEvidence: string;
    }>;
    defaults: Readonly<{
      cefr: ArticleCandidateDraft["cefr"];
      topics: readonly string[];
      region: string;
      register: string;
      format: ArticleCandidateDraft["format"];
      oralTransferType: ArticleCandidateDraft["oralTransferType"];
    }>;
    maxBytes?: number;
    now?: () => Date;
  }>) {}

  async discover(
    input: ContentSourceDiscoveryInput,
    requestOptions?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ContentSourcePage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
      throw new ContentSourceAdapterError("Discovery limit is outside the supported range.", false);
    }
    const cursor = parseCursor(input.cursor, input.externalSourceId);
    const headers = new Headers({ accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" });
    const validatorUrl = cursor.validatorUrl ?? cursor.url;
    if (validatorUrl === cursor.url && cursor.etag) headers.set("if-none-match", cursor.etag);
    if (validatorUrl === cursor.url && cursor.lastModified) headers.set("if-modified-since", cursor.lastModified);
    const response = await fetchBoundedText({
      url: cursor.url,
      fetch: this.options.fetch,
      allowedHosts: this.options.allowedHosts,
      allowedContentTypes: ["application/rss+xml", "application/atom+xml", "application/xml", "text/xml"],
      maxBytes: this.options.maxBytes ?? 1_000_000,
      headers,
      signal: requestOptions?.signal,
    });
    if (response.status === 304) {
      return { sourceStableKey: input.sourceStableKey, cursor: input.cursor, nextCursor: input.cursor, estimatedCostMicros: 0, items: [] };
    }

    const document = parseXml(response.text);
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    const items: ContentSourcePage["items"][number][] = [];
    for (const entry of feedEntries(document)) {
      if (items.length >= input.limit) break;
      const rawUrl = elementUrl(entry);
      const rawId = text(first(entry, "guid", "id")) || rawUrl;
      const feedTitle = extractPlainTextFragment(text(first(entry, "title")));
      if (!rawUrl || !rawId || !feedTitle || seenIds.has(rawId)) continue;
      let normalizedFeedUrl: string;
      try {
        normalizedFeedUrl = normalizeCandidateUrl(rawUrl);
      } catch {
        continue;
      }
      if (!normalizedFeedUrl.startsWith("https://") || seenUrls.has(normalizedFeedUrl)) continue;
      let page;
      try {
        page = await this.options.pageAdapter.fetchArticle(normalizedFeedUrl, { signal: requestOptions?.signal });
      } catch (error) {
        if (requestOptions?.signal?.aborted) throw error;
        continue;
      }
      try {
        const feedSummary = extractPlainTextFragment(text(first(entry, "description", "summary", "content")));
        const item = normalizeArticleCandidate({
          sourceStableKey: input.sourceStableKey,
          externalItemId: rawId,
          canonicalUrl: page.canonicalUrl,
          title: page.title ?? feedTitle,
          summary: page.summary ?? feedSummary,
          author: page.author ?? (extractPlainTextFragment(text(first(entry, "author", "creator"))) || null),
          publishedAt: isoTimestamp(text(first(entry, "pubdate", "published", "updated"))),
          fetchedAt: page.fetchedAt,
          paragraphs: page.paragraphs,
          source: this.options.source,
          defaults: this.options.defaults,
        });
        if (seenUrls.has(item.canonicalUrl)) continue;
        seenIds.add(rawId);
        seenUrls.add(item.canonicalUrl);
        items.push(item);
      } catch {
        continue;
      }
    }

    const nextUrl = nextFeedUrl(document, response.url) ?? input.externalSourceId;
    const nextCursor = JSON.stringify({
      url: nextUrl,
      validatorUrl: response.url,
      ...(response.headers.get("etag") ? { etag: response.headers.get("etag")! } : {}),
      ...(response.headers.get("last-modified") ? { lastModified: response.headers.get("last-modified")! } : {}),
    });
    return {
      sourceStableKey: input.sourceStableKey,
      cursor: input.cursor,
      nextCursor,
      estimatedCostMicros: 0,
      items,
    };
  }
}
