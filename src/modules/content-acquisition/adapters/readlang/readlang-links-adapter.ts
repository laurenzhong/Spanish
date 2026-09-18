import { createHash } from "node:crypto";

import { parse } from "parse5";

import type { ContentSourcePage } from "../../schemas";
import { normalizeCandidateUrl } from "../../domain";
import { normalizeArticleCandidate } from "../../normalizers";
import {
  ContentSourceAdapterError,
  type ContentSourceAdapter,
  type ContentSourceDiscoveryInput,
} from "../content-source-adapter";
import { fetchBoundedText } from "../http/bounded-text-fetch";
import { isReadlangAllowlistedUrl, normalizeReadlangLink, type ReadlangLinksPolicy } from "./readlang-links-policy";

type HtmlNode = Readonly<{
  nodeName?: string;
  tagName?: string;
  value?: string;
  attrs?: readonly Readonly<{ name: string; value: string }>[];
  childNodes?: readonly HtmlNode[];
}>;

function attribute(node: HtmlNode, name: string): string | null {
  return node.attrs?.find((item) => item.name.toLowerCase() === name)?.value ?? null;
}

function descendants(node: HtmlNode, predicate: (candidate: HtmlNode) => boolean): HtmlNode[] {
  const result: HtmlNode[] = [];
  for (const child of node.childNodes ?? []) {
    if (predicate(child)) result.push(child);
    result.push(...descendants(child, predicate));
  }
  return result;
}

function textContent(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  if (["script", "style", "template", "noscript"].includes(node.tagName ?? "")) return "";
  return (node.childNodes ?? []).map(textContent).join(" ");
}

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
}

function collectLinks(html: string, sourceUrl: string, policy: ReadlangLinksPolicy): readonly string[] {
  const document = parse(html) as unknown as HtmlNode;
  return [...new Set(descendants(document, (node) => node.tagName === "a")
    .map((node) => attribute(node, "href"))
    .filter((href): href is string => Boolean(href))
    .map((href) => {
      try {
        const resolved = new URL(href, sourceUrl);
        if (resolved.protocol === "http:") resolved.protocol = "https:";
        return normalizeReadlangLink(resolved.toString(), policy);
      } catch {
        return null;
      }
    })
    .filter((href): href is string => Boolean(href)))];
}

function articleParagraphs(html: string): Readonly<{ title: string; summary: string; paragraphs: readonly string[] }> {
  const document = parse(html) as unknown as HtmlNode;
  const article = descendants(document, (node) => node.tagName === "article")[0]
    ?? descendants(document, (node) => node.tagName === "main")[0]
    ?? document;
  const paragraphs = descendants(article, (node) => node.tagName === "p")
    .map((node) => cleanText(textContent(node)))
    .filter((value) => value.length > 0)
    .slice(0, 500);
  const titleNode = descendants(document, (node) => node.tagName === "title")[0];
  const title = cleanText(titleNode ? textContent(titleNode) : "");
  return { title, summary: paragraphs.join(" ").slice(0, 400), paragraphs };
}

function cursorPage(value: string | null): Readonly<{ url: string; offset: number }> {
  if (!value) return { url: "https://readlang.com/es/links", offset: 0 };
  try {
    const parsed = JSON.parse(value) as { url?: unknown; offset?: unknown };
    if (typeof parsed.url !== "string" || typeof parsed.offset !== "number" || !Number.isInteger(parsed.offset) || parsed.offset < 0) throw new Error();
    return { url: parsed.url, offset: parsed.offset };
  } catch {
    throw new ContentSourceAdapterError("Readlang links cursor is invalid.", false);
  }
}

export class ReadlangLinksAdapter implements ContentSourceAdapter {
  readonly key = "readlang-links" as const;

  constructor(private readonly options: Readonly<{
    fetch: typeof fetch;
    policy: ReadlangLinksPolicy;
    maxPageBytes?: number;
    maxArticleBytes?: number;
    now?: () => Date;
  }>) {}

  async discover(input: ContentSourceDiscoveryInput, requestOptions?: Readonly<{ signal?: AbortSignal }>): Promise<ContentSourcePage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new ContentSourceAdapterError("Readlang discovery limit is outside the supported range.", false);
    }
    if (input.externalSourceId !== this.options.policy.sourceUrl || !isReadlangAllowlistedUrl(input.externalSourceId, { ...this.options.policy, allowlist: { hosts: ["readlang.com"], urls: [this.options.policy.sourceUrl], urlPrefixes: ["https://readlang.com/es/links"] } })) {
      throw new ContentSourceAdapterError("Readlang source URL does not match the authorized policy.", false);
    }
    const cursor = cursorPage(input.cursor);
    const page = await fetchBoundedText({
      url: cursor.url,
      fetch: this.options.fetch,
      allowedHosts: ["readlang.com"],
      allowedContentTypes: ["text/html", "application/xhtml+xml"],
      maxBytes: this.options.maxPageBytes ?? 1_500_000,
      signal: requestOptions?.signal,
      isAllowedUrl: (url) => url.toString() === this.options.policy.sourceUrl,
    });
    const links = collectLinks(page.text, page.url, this.options.policy);
    const selected = links.slice(cursor.offset, cursor.offset + input.limit);
    const items: ContentSourcePage["items"][number][] = [];
    for (const url of selected) {
      let article;
      try {
        const response = await fetchBoundedText({
          url,
          fetch: this.options.fetch,
          allowedHosts: this.options.policy.allowlist.hosts,
          allowedContentTypes: ["text/html", "application/xhtml+xml"],
          maxBytes: this.options.maxArticleBytes ?? 1_500_000,
          signal: requestOptions?.signal,
          isAllowedUrl: (candidate) => isReadlangAllowlistedUrl(candidate.toString(), this.options.policy),
        });
        article = articleParagraphs(response.text);
      } catch (error) {
        if (requestOptions?.signal?.aborted) throw error;
        continue;
      }
      if (!article.title || article.paragraphs.length === 0) continue;
      const normalizedUrl = normalizeCandidateUrl(url);
      try {
        const item = normalizeArticleCandidate({
          sourceStableKey: input.sourceStableKey,
          externalItemId: createHash("sha256").update(normalizedUrl).digest("hex"),
          canonicalUrl: normalizedUrl,
          title: article.title,
          summary: article.summary,
          author: null,
          publishedAt: null,
          fetchedAt: (this.options.now ?? (() => new Date()))().toISOString(),
          paragraphs: article.paragraphs,
          source: {
            sourceName: "Readlang authorized links",
            sourceType: this.options.policy.license === "owner-authorized" ? "licensed" : this.options.policy.license,
            license: this.options.policy.license === "owner-authorized" ? "licensed" : this.options.policy.license,
            attribution: this.options.policy.attribution,
            licenseEvidence: this.options.policy.authorization.evidenceUrl,
          },
          defaults: {
            cefr: "B1",
            topics: ["topic.general"],
            region: "general",
            register: "neutral",
            format: "essay",
            oralTransferType: "none",
          },
        });
        items.push(item);
      } catch {
        // A malformed page remains outside the candidate pool; the cursor still advances.
      }
    }
    const nextOffset = cursor.offset + selected.length;
    return {
      sourceStableKey: input.sourceStableKey,
      cursor: input.cursor,
      nextCursor: JSON.stringify({ url: page.url, offset: nextOffset }),
      estimatedCostMicros: 0,
      items,
    };
  }
}
