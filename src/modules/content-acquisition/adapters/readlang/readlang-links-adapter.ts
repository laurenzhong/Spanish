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

const POPULAR_DOMAINS_API = "https://readlang.com/api/popularDomains?language=es&limit=50";
const REQUEST_TIMEOUT_MS = 15_000;

type PopularDomain = Readonly<{
  domainName?: unknown;
  path?: unknown;
}>;

type ReadlangBook = Readonly<{
  _id?: unknown;
  title?: unknown;
  author?: unknown;
  language?: unknown;
  category?: unknown;
  firstShareDate?: unknown;
  metrics?: Readonly<{ CEF?: unknown; vocabCEF?: unknown; ARICEF?: unknown }>;
  htmlChunks?: readonly Readonly<{ sha1?: unknown }>[];
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

function splitLongParagraph(value: string): readonly string[] {
  const maxLength = 7_500;
  if (value.length <= maxLength) return [value];
  const chunks: string[] = [];
  let remaining = value;
  while (remaining.length > maxLength) {
    const splitAt = remaining.lastIndexOf(" ", maxLength);
    const boundary = splitAt > 1_000 ? splitAt : maxLength;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
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

function collectPopularDomainLinks(json: string, policy: ReadlangLinksPolicy): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed
    .map((value): string | null => {
      if (!value || typeof value !== "object") return null;
      const item = value as PopularDomain;
      if (typeof item.domainName !== "string" || typeof item.path !== "string") return null;
      try {
        const url = new URL(`https://${item.domainName}${item.path.startsWith("/") ? item.path : `/${item.path}`}`);
        return normalizeReadlangLink(url.toString(), policy);
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value)))];
}

function boundedSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function firstMeta(document: HtmlNode, key: string, value: string): string | null {
  const node = descendants(document, (candidate) => candidate.tagName === "meta").find((candidate) =>
    attribute(candidate, key)?.toLowerCase() === value.toLowerCase(),
  );
  const content = node ? attribute(node, "content") : null;
  return content ? cleanText(content) : null;
}

function firstHeading(document: HtmlNode): string | null {
  const heading = descendants(document, (node) => node.tagName === "h1")[0];
  return heading ? cleanText(textContent(heading)) : null;
}

function completeSentence(value: string): string {
  const normalized = cleanText(value);
  if (normalized.length <= 400) return normalized;
  const bounded = normalized.slice(0, 400);
  const match = bounded.match(/^.*[.!?](?:["'”»)]*)?(?=\s|$)/u);
  if (match?.[0]) return match[0].trim();
  return `${bounded.replace(/\s+\S*$/u, "").trim()}…`;
}

function isNoiseParagraph(value: string): boolean {
  return /^Artículo relacionado\b/iu.test(value)
    || /^Download the CNN app\b/iu.test(value)
    || /^(?:Suscríbete|Más noticias|Síguenos)\b/iu.test(value)
    || /(?:Literatura\.us|Mapa de la biblioteca|Aviso Legal|Quiénes Somos|Contactar)/iu.test(value);
}

function isLiteraturaFrontMatter(value: string): boolean {
  return /(?:Barranquilla|Nueva York|págs?\.?\)|Editorial|Ediciones Librería|Saroyan|Among the Lost|to be among the lost)/iu.test(value)
    || /^\s*[“"]?\.\.\./u.test(value);
}

function literaryTitleAndAuthor(documentTitle: string): Readonly<{ title: string | null; author: string | null }> {
  const match = documentTitle.match(/^(.+?),\s+(.+?)\s+\(\d{4}\s*[-–]\s*\d{4}\)$/u);
  return match
    ? { title: cleanText(match[1]), author: cleanText(match[2]) }
    : { title: null, author: null };
}

function articleParagraphs(html: string, sourceUrl: string): Readonly<{
  title: string;
  summary: string;
  author: string | null;
  publishedAt: string | null;
  paragraphs: readonly string[];
}> {
  const document = parse(html) as unknown as HtmlNode;
  const hostname = new URL(sourceUrl).hostname.toLowerCase();
  const article = descendants(document, (node) => node.tagName === "article")[0]
    ?? descendants(document, (node) => node.tagName === "main")[0]
    ?? document;
  let paragraphs = descendants(article, (node) => node.tagName === "p")
    .map((node) => cleanText(textContent(node)))
    .filter((value) => value.length > 0 && !isNoiseParagraph(value));
  if (hostname === "www.literatura.us" || hostname === "literatura.us") {
    const firstStoryParagraph = paragraphs.findIndex((value, index) => index > 0 && !isLiteraturaFrontMatter(value) && value.split(/\s+/u).length >= 12);
    paragraphs = paragraphs.slice(firstStoryParagraph >= 0 ? firstStoryParagraph : 0);
  }
  paragraphs = [...new Set(paragraphs)].flatMap(splitLongParagraph).slice(0, 500);
  const titleNode = descendants(document, (node) => node.tagName === "title")[0];
  const documentTitle = cleanText(titleNode ? textContent(titleNode) : "");
  const literary = hostname === "www.literatura.us" || hostname === "literatura.us"
    ? literaryTitleAndAuthor(documentTitle)
    : { title: null, author: null };
  const title = literary.title
    ?? firstHeading(document)
    ?? firstMeta(document, "property", "og:title")
    ?? documentTitle.replace(/\s*\|\s*CNN\s*$/iu, "");
  const description = firstMeta(document, "name", "description") ?? firstMeta(document, "property", "og:description");
  return {
    title,
    summary: completeSentence(description ?? paragraphs.join(" ")),
    author: firstMeta(document, "name", "author") ?? literary.author,
    publishedAt: firstMeta(document, "property", "article:published_time") ?? firstMeta(document, "name", "date"),
    paragraphs,
  };
}

function readlangCategory(value: unknown): Readonly<{
  cefr: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  topic: string;
  format: "news" | "essay" | "dialogue" | "guide" | "story";
  oralTransferType: "none" | "summary" | "opinion" | "personal_transfer";
}> {
  const category = typeof value === "string" ? value : "";
  return {
    cefr: "B1",
    topic: category === "Fiction" ? "topic.fiction" : category === "Conversation" ? "topic.conversation" : category === "Non-Fiction" ? "topic.non-fiction" : "topic.general",
    format: category === "Fiction" ? "story" : category === "Conversation" ? "dialogue" : category === "Other" ? "guide" : "essay",
    oralTransferType: category === "Fiction" ? "opinion" : "none",
  };
}

function readlangCefr(book: ReadlangBook): "A1" | "A2" | "B1" | "B2" | "C1" | "C2" {
  const values = [book.metrics?.CEF, book.metrics?.vocabCEF, book.metrics?.ARICEF];
  return (values.find((value): value is "A1" | "A2" | "B1" | "B2" | "C1" | "C2" => typeof value === "string" && ["A1", "A2", "B1", "B2", "C1", "C2"].includes(value)) ?? "B1");
}

async function readlangLibraryArticle(input: Readonly<{
  url: string;
  bookId: string;
  fetch: typeof fetch;
  maxBytes: number;
  signal?: AbortSignal;
}>): Promise<Readonly<{
  title: string;
  summary: string;
  author: string | null;
  publishedAt: string | null;
  paragraphs: readonly string[];
  cefr: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  topic: string;
  format: "news" | "essay" | "dialogue" | "guide" | "story";
  oralTransferType: "none" | "summary" | "opinion" | "personal_transfer";
}> > {
  const apiUrl = `https://readlang.com/api/book/${encodeURIComponent(input.bookId)}`;
  const bookResponse = await fetchBoundedText({
    url: apiUrl,
    fetch: input.fetch,
    allowedHosts: ["readlang.com"],
    allowedContentTypes: ["application/json"],
    maxBytes: Math.min(input.maxBytes, 500_000),
    signal: boundedSignal(input.signal),
    isAllowedUrl: (url) => url.origin === "https://readlang.com" && url.pathname === `/api/book/${encodeURIComponent(input.bookId)}`,
  });
  let book: ReadlangBook;
  try {
    book = JSON.parse(bookResponse.text) as ReadlangBook;
  } catch {
    throw new ContentSourceAdapterError("Readlang book response is not valid JSON.", false);
  }
  if (book._id !== input.bookId || typeof book.title !== "string" || !Array.isArray(book.htmlChunks) || book.htmlChunks.length === 0 || book.htmlChunks.length > 500) {
    throw new ContentSourceAdapterError("Readlang book response is incomplete.", false);
  }
  const chunks: string[] = [];
  for (const chunk of book.htmlChunks) {
    if (typeof chunk.sha1 !== "string" || !/^[a-f0-9]{40}$/u.test(chunk.sha1)) {
      throw new ContentSourceAdapterError("Readlang book chunk reference is invalid.", false);
    }
    const chunkUrl = `https://readlang.com/api/chunk/${chunk.sha1}`;
    const chunkResponse = await fetchBoundedText({
      url: chunkUrl,
      fetch: input.fetch,
      allowedHosts: ["readlang.com"],
      allowedContentTypes: ["text/plain", "text/html"],
      maxBytes: input.maxBytes,
      signal: boundedSignal(input.signal),
      isAllowedUrl: (url) => url.origin === "https://readlang.com" && url.pathname === `/api/chunk/${chunk.sha1}`,
    });
    chunks.push(chunkResponse.text);
  }
  const parsed = articleParagraphs(`<html><head><title>${book.title}</title></head><body><article>${chunks.join("\n")}</article></body></html>`, input.url);
  const category = readlangCategory(book.category);
  return {
    ...parsed,
    title: cleanText(book.title),
    author: typeof book.author === "string" ? cleanText(book.author) : parsed.author,
    publishedAt: typeof book.firstShareDate === "string" ? book.firstShareDate : parsed.publishedAt,
    cefr: readlangCefr(book),
    topic: category.topic,
    format: category.format,
    oralTransferType: category.oralTransferType,
  };
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
    if (input.externalSourceId !== this.options.policy.sourceUrl || !isReadlangAllowlistedUrl(input.externalSourceId, { ...this.options.policy, allowlist: { hosts: ["readlang.com"], urls: [this.options.policy.sourceUrl], urlPrefixes: [this.options.policy.sourceUrl, "https://readlang.com/es/links"] } })) {
      throw new ContentSourceAdapterError("Readlang source URL does not match the authorized policy.", false);
    }
    const cursor = cursorPage(input.cursor);
    const authorizedSourceUrl = new URL(this.options.policy.sourceUrl);
    const page = await fetchBoundedText({
      url: cursor.url,
      fetch: this.options.fetch,
      allowedHosts: ["readlang.com"],
      allowedContentTypes: ["text/html", "application/xhtml+xml"],
      maxBytes: this.options.maxPageBytes ?? 1_500_000,
      signal: boundedSignal(requestOptions?.signal),
      isAllowedUrl: (url) => url.origin === authorizedSourceUrl.origin
        && url.pathname === authorizedSourceUrl.pathname
        && (url.search === authorizedSourceUrl.search || url.search === ""),
    });
    let links = collectLinks(page.text, page.url, this.options.policy);
    if (links.length === 0) {
      try {
        const apiPage = await fetchBoundedText({
          url: POPULAR_DOMAINS_API,
          fetch: this.options.fetch,
          allowedHosts: ["readlang.com"],
          allowedContentTypes: ["application/json"],
          maxBytes: 500_000,
          signal: boundedSignal(requestOptions?.signal),
          isAllowedUrl: (url) => url.toString() === POPULAR_DOMAINS_API,
        });
        links = collectPopularDomainLinks(apiPage.text, this.options.policy);
      } catch (error) {
        if (requestOptions?.signal?.aborted) throw error;
      }
    }
    // The client-rendered directory mostly returns domain homepages. Keep the
    // exact non-home URLs already present in the policy snapshot at the front
    // of the page so an authorized article is not starved by those homepages.
    const snapshotArticleLinks = this.options.policy.allowlist.urls.filter((value) => {
      try {
        const url = new URL(value);
        return url.pathname !== "/" || url.search.length > 0;
      } catch {
        return false;
      }
    });
    links = [...new Set([...snapshotArticleLinks, ...links])];
    const items: ContentSourcePage["items"][number][] = [];
    let scanOffset = cursor.offset;
    while (items.length < input.limit && scanOffset < links.length) {
      const selected = links.slice(scanOffset, scanOffset + input.limit);
      for (const url of selected) {
      let article;
      const libraryMatch = new URL(url).pathname.match(/^\/library\/([A-Za-z0-9_-]+)$/u);
      try {
        if (libraryMatch) {
          article = await readlangLibraryArticle({
            url,
            bookId: libraryMatch[1]!,
            fetch: this.options.fetch,
            maxBytes: this.options.maxArticleBytes ?? 1_500_000,
            signal: requestOptions?.signal,
          })
        } else {
          const response = await fetchBoundedText({
            url,
            fetch: this.options.fetch,
            allowedHosts: this.options.policy.allowlist.hosts,
            allowedContentTypes: ["text/html", "application/xhtml+xml"],
            maxBytes: this.options.maxArticleBytes ?? 1_500_000,
            signal: boundedSignal(requestOptions?.signal),
            isAllowedUrl: (candidate) => isReadlangAllowlistedUrl(candidate.toString(), this.options.policy)
              || this.options.policy.allowlist.urls.some((allowed) => {
                const expected = new URL(allowed);
                return expected.origin === candidate.origin
                  && expected.pathname === candidate.pathname
                  && candidate.search === "";
              }),
          });
          article = articleParagraphs(response.text, response.url);
        }
      } catch (error) {
        if (requestOptions?.signal?.aborted) throw error;
        continue;
      }
      if (!article.title || article.paragraphs.length === 0) continue;
      const normalizedUrl = normalizeCandidateUrl(url);
      const readlangArticle = libraryMatch ? article as Awaited<ReturnType<typeof readlangLibraryArticle>> : null;
      try {
        const host = new URL(normalizedUrl).hostname.toLowerCase();
        const isLiteratura = host === "www.literatura.us" || host === "literatura.us";
        const isCnn = host === "cnnespanol.cnn.com";
        const item = normalizeArticleCandidate({
          sourceStableKey: input.sourceStableKey,
          externalItemId: createHash("sha256").update(normalizedUrl).digest("hex"),
          canonicalUrl: normalizedUrl,
          title: article.title,
          summary: article.summary,
          author: article.author,
          publishedAt: article.publishedAt,
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
            cefr: readlangArticle?.cefr ?? (isLiteratura ? "C1" : isCnn ? "B1" : "B1"),
            topics: [readlangArticle?.topic ?? (isLiteratura ? "topic.literature" : isCnn ? "topic.news" : "topic.general")],
            region: isLiteratura ? "Latin America" : isCnn ? "international" : "general",
            register: isLiteratura ? "literary" : isCnn ? "journalistic" : "neutral",
            format: readlangArticle?.format ?? (isLiteratura ? "story" : isCnn ? "news" : "essay"),
            oralTransferType: readlangArticle?.oralTransferType ?? (isLiteratura ? "opinion" : isCnn ? "summary" : "none"),
          },
        });
        items.push(item);
      } catch {
        // A malformed page remains outside the candidate pool; the cursor still advances.
      }
      }
      scanOffset += selected.length;
    }
    // Keep failed pages retryable; advancing an empty batch would silently lose an allowlisted source.
    const nextOffset = items.length === 0 ? cursor.offset : scanOffset;
    return {
      sourceStableKey: input.sourceStableKey,
      cursor: input.cursor,
      nextCursor: JSON.stringify({ url: page.url, offset: nextOffset }),
      estimatedCostMicros: 0,
      items,
    };
  }
}
