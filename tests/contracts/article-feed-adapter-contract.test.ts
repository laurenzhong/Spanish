// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  ArticleRssAdapter,
  ArticleSourceAdapter,
  ContentSourceAdapterError,
} from "@/src/modules/content-acquisition";

const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "content-acquisition");

async function fixture(relativePath: string) {
  return readFile(path.join(fixtureRoot, relativePath), "utf8");
}

function response(body: BodyInit | null, init: ResponseInit & { url?: string } = {}) {
  const result = new Response(body, init);
  Object.defineProperty(result, "url", {
    configurable: true,
    value: init.url ?? "https://feeds.example.test/rss.xml",
  });
  return result;
}

function adapter(fetchImpl: typeof fetch) {
  const pageAdapter = new ArticleSourceAdapter({
    fetch: fetchImpl,
    allowedHosts: ["news.example.test"],
    maxBytes: 64_000,
    now: () => new Date("2026-09-13T00:00:00.000Z"),
  });
  return new ArticleRssAdapter({
    fetch: fetchImpl,
    allowedHosts: ["feeds.example.test"],
    pageAdapter,
    maxBytes: 64_000,
    source: {
      sourceName: "Noticias de ejemplo",
      sourceType: "creative_commons",
      license: "creative_commons",
      attribution: "Noticias de ejemplo / CC BY 4.0",
      licenseEvidence: "https://news.example.test/licencia",
    },
    defaults: {
      cefr: "B1",
      topics: ["topic.current-events"],
      region: "es-ES",
      register: "neutral",
      format: "news",
      oralTransferType: "opinion",
    },
    now: () => new Date("2026-09-13T00:00:00.000Z"),
  });
}

describe("article RSS adapter contract", () => {
  it("uses validators, follows the feed cursor and returns normalized article drafts", async () => {
    const rss = await fixture("article-feed/valid-rss.xml");
    const html = await fixture("article-pages/valid-article.html");
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://news.example.test/")) {
        return response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
          url: "https://news.example.test/noticias/uno",
        });
      }
      expect(init?.redirect).toBe("manual");
      return response(rss, {
        status: 200,
        headers: {
          "content-type": "application/rss+xml; charset=utf-8",
          etag: '"feed-v1"',
          "last-modified": "Fri, 12 Sep 2026 10:00:00 GMT",
        },
      });
    });

    const result = await adapter(fetchMock).discover({
      sourceStableKey: "news.example",
      externalSourceId: "https://feeds.example.test/rss.xml",
      cursor: null,
      limit: 10,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      externalItemId: "noticia-uno",
      canonicalUrl: "https://news.example.test/noticias/uno",
      contentType: "article",
      language: "es",
      metadata: {
        articleDraft: {
          author: "María Ejemplo",
          fetchedAt: "2026-09-13T00:00:00.000Z",
          license: "creative_commons",
          paragraphs: [
            "La biblioteca del barrio abre una nueva sala para estudiantes.",
            "El espacio ofrece clubes de conversación todos los jueves.",
          ],
        },
      },
    });
    expect(result.items[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.nextCursor).toContain("archive?page=2");
    expect(result.nextCursor).toContain("feed-v1");

    const cursor = JSON.stringify({
      url: "https://feeds.example.test/rss.xml",
      etag: '"feed-v1"',
      lastModified: "Fri, 12 Sep 2026 10:00:00 GMT",
    });
    const conditionalFetch = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("if-none-match")).toBe('"feed-v1"');
      expect(new Headers(init?.headers).get("if-modified-since")).toBe("Fri, 12 Sep 2026 10:00:00 GMT");
      return response(null, { status: 304 });
    });
    const unchanged = await adapter(conditionalFetch).discover({
      sourceStableKey: "news.example",
      externalSourceId: "https://feeds.example.test/rss.xml",
      cursor,
      limit: 10,
    });
    expect(unchanged).toMatchObject({ items: [], nextCursor: cursor });
  });

  it("fails closed on non-HTTPS URLs, cross-allowlist redirects and oversized responses", async () => {
    const never = vi.fn<typeof fetch>();
    await expect(adapter(never).discover({
      sourceStableKey: "news.example",
      externalSourceId: "http://feeds.example.test/rss.xml",
      cursor: null,
      limit: 10,
    })).rejects.toBeInstanceOf(ContentSourceAdapterError);
    expect(never).not.toHaveBeenCalled();

    const redirect = vi.fn<typeof fetch>(async () => response(null, {
      status: 302,
      headers: { location: "https://attacker.example/rss.xml" },
    }));
    await expect(adapter(redirect).discover({
      sourceStableKey: "news.example",
      externalSourceId: "https://feeds.example.test/rss.xml",
      cursor: null,
      limit: 10,
    })).rejects.toThrow("allowlist");

    const tooLarge = vi.fn<typeof fetch>(async () => response("small", {
      status: 200,
      headers: {
        "content-type": "application/rss+xml",
        "content-length": "999999",
      },
    }));
    await expect(adapter(tooLarge).discover({
      sourceStableKey: "news.example",
      externalSourceId: "https://feeds.example.test/rss.xml",
      cursor: null,
      limit: 10,
    })).rejects.toThrow("size limit");
  });

  it("deduplicates GUIDs and canonical URLs, skips missing bodies and rejects invalid XML encodings", async () => {
    const feed = `<?xml version="1.0" encoding="UTF-8"?><rss><channel>
      <item><guid>same-guid</guid><link>https://news.example.test/one?utm_source=a</link><title>Uno</title></item>
      <item><guid>same-guid</guid><link>https://news.example.test/two</link><title>Dos</title></item>
      <item><guid>third-guid</guid><link>https://news.example.test/one</link><title>Tres</title></item>
      <item><guid>empty-guid</guid><link>https://news.example.test/empty</link><title>Sin cuerpo</title></item>
    </channel></rss>`;
    const validHtml = await fixture("article-pages/valid-article.html");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/empty")) {
        return response("<html><body><article></article></body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
          url,
        });
      }
      if (url.startsWith("https://news.example.test/")) {
        return response(validHtml, { status: 200, headers: { "content-type": "text/html" }, url });
      }
      return response(feed, { status: 200, headers: { "content-type": "application/xml" } });
    });
    const result = await adapter(fetchMock).discover({
      sourceStableKey: "news.example",
      externalSourceId: "https://feeds.example.test/rss.xml",
      cursor: null,
      limit: 10,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.externalItemId).toBe("same-guid");

    const badEncoding = vi.fn<typeof fetch>(async () => response(new Uint8Array([0xff, 0xfe, 0xfd]), {
      status: 200,
      headers: { "content-type": "application/xml; charset=utf-8" },
    }));
    await expect(adapter(badEncoding).discover({
      sourceStableKey: "news.example",
      externalSourceId: "https://feeds.example.test/rss.xml",
      cursor: null,
      limit: 10,
    })).rejects.toThrow("encoding");

    const doctype = vi.fn<typeof fetch>(async () => response(
      '<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///etc/passwd">]><rss><channel /></rss>',
      { status: 200, headers: { "content-type": "application/xml" } },
    ));
    await expect(adapter(doctype).discover({
      sourceStableKey: "news.example",
      externalSourceId: "https://feeds.example.test/rss.xml",
      cursor: null,
      limit: 10,
    })).rejects.toThrow("Document type");
  });
});
