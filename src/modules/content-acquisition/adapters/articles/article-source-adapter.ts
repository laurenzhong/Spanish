import { parse } from "parse5";

import { normalizeCandidateUrl } from "../../domain";
import { ContentSourceAdapterError } from "../content-source-adapter";
import { fetchBoundedText } from "../http/bounded-text-fetch";

type HtmlNode = Readonly<{
  nodeName?: string;
  tagName?: string;
  value?: string;
  attrs?: readonly Readonly<{ name: string; value: string }>[];
  childNodes?: readonly HtmlNode[];
}>;

export type ExtractedArticlePage = Readonly<{
  canonicalUrl: string;
  title: string | null;
  summary: string | null;
  author: string | null;
  paragraphs: readonly string[];
  fetchedAt: string;
}>;

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
}

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
  if (node.tagName === "script" || node.tagName === "style" || node.tagName === "template") return "";
  return (node.childNodes ?? []).map(textContent).join(" ");
}

const noiseTerms = ["nav", "menu", "footer", "header", "sidebar", "advert", "cookie", "social", "comment"] as const;

function isNoiseNode(node: HtmlNode): boolean {
  if (["nav", "footer", "aside", "header", "form", "script", "style", "template"].includes(node.tagName ?? "")) return true;
  const marker = `${attribute(node, "class") ?? ""} ${attribute(node, "id") ?? ""}`.toLowerCase();
  return noiseTerms.some((term) => marker.includes(term));
}

function collectParagraphs(node: HtmlNode): HtmlNode[] {
  if (isNoiseNode(node)) return [];
  const result: HtmlNode[] = [];
  for (const child of node.childNodes ?? []) {
    if (isNoiseNode(child)) continue;
    if (child.tagName === "p") result.push(child);
    else result.push(...collectParagraphs(child));
  }
  return result;
}

export function extractPlainTextFragment(html: string): string {
  const fragment = parse(html) as unknown as HtmlNode;
  return cleanText(textContent(fragment));
}

function firstMeta(document: HtmlNode, key: string, value: string): string | null {
  const node = descendants(document, (candidate) => candidate.tagName === "meta").find((candidate) =>
    attribute(candidate, key)?.toLowerCase() === value,
  );
  const content = node ? attribute(node, "content") : null;
  return content ? cleanText(content) : null;
}

export function extractArticlePage(html: string, canonicalUrl: string, fetchedAt: string): ExtractedArticlePage {
  const document = parse(html) as unknown as HtmlNode;
  const article = descendants(document, (node) => node.tagName === "article")[0];
  const main = descendants(document, (node) => node.tagName === "main")[0];
  const paragraphRoot = article ?? main ?? document;
  const paragraphs = collectParagraphs(paragraphRoot)
    .map((node) => cleanText(textContent(node)))
    .filter((text) => text.length > 0)
    .slice(0, 500);
  const titleNode = descendants(document, (node) => node.tagName === "title")[0];
  const title = titleNode ? cleanText(textContent(titleNode)) : null;
  return {
    canonicalUrl: normalizeCandidateUrl(canonicalUrl),
    title: title || null,
    summary: firstMeta(document, "name", "description") ?? firstMeta(document, "property", "og:description"),
    author: firstMeta(document, "name", "author"),
    paragraphs,
    fetchedAt,
  };
}

export class ArticleSourceAdapter {
  constructor(private readonly options: Readonly<{
    fetch: typeof fetch;
    allowedHosts: readonly string[];
    maxBytes?: number;
    now?: () => Date;
  }>) {}

  async fetchArticle(url: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<ExtractedArticlePage> {
    const response = await fetchBoundedText({
      url,
      fetch: this.options.fetch,
      allowedHosts: this.options.allowedHosts,
      allowedContentTypes: ["text/html", "application/xhtml+xml"],
      maxBytes: this.options.maxBytes ?? 1_500_000,
      signal: options?.signal,
    });
    const page = extractArticlePage(
      response.text,
      response.url,
      (this.options.now ?? (() => new Date()))().toISOString(),
    );
    if (page.paragraphs.length === 0) {
      throw new ContentSourceAdapterError("Article page does not contain a usable body.", false);
    }
    return page;
  }
}
