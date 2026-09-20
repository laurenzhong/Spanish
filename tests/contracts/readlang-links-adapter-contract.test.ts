// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  ReadlangLinksAdapter,
  ContentSourceAdapterError,
  readlangLinksPolicySchema,
  type ReadlangLinksPolicy,
} from "@/src/modules/content-acquisition";

function response(body: BodyInit | null, init: ResponseInit & { url?: string } = {}) {
  const result = new Response(body, init);
  Object.defineProperty(result, "url", { configurable: true, value: init.url ?? "https://readlang.com/es/links" });
  return result;
}

const policy: ReadlangLinksPolicy = readlangLinksPolicySchema.parse({
  policyVersion: "readlang-links-test-v1",
  sourceUrl: "https://readlang.com/es/links",
  authorization: { status: "owner-authorized", evidenceUrl: "https://readlang.com/es/links" },
  allowlist: {
    hosts: ["readlang.com", "news.example.test"],
    urls: ["https://news.example.test/one"],
    urlPrefixes: ["https://readlang.com/es/links"],
  },
  contentMode: "full_text",
  license: "owner-authorized",
  attribution: "Readlang authorized links",
  automatedPublication: { enabled: false, policyVersion: "readlang-links-test-v1", dailyLimit: 10 },
});

describe("Readlang links adapter contract", () => {
  it("snapshots authorized links, upgrades legacy HTTP seeds to HTTPS, and normalizes article candidates", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "https://readlang.com/es/links") {
        return response('<html><body><a href="http://news.example.test/one">Uno</a><a href="https://attacker.example/two">No</a></body></html>', { headers: { "content-type": "text/html" } });
      }
      expect(url).toBe("https://news.example.test/one");
      return response("<html><head><title>Una noticia</title></head><body><article><p>La biblioteca abre una sala nueva.</p><p>El barrio organiza conversación.</p></article></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
        url,
      });
    });
    const adapter = new ReadlangLinksAdapter({ fetch: fetchMock, policy, now: () => new Date("2026-09-18T00:00:00.000Z") });
    const result = await adapter.discover({ sourceStableKey: "readlang.links", externalSourceId: policy.sourceUrl, cursor: null, limit: 10 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      canonicalUrl: "https://news.example.test/one",
      contentType: "article",
      language: "es",
      metadata: { articleDraft: { title: "Una noticia", paragraphs: ["La biblioteca abre una sala nueva.", "El barrio organiza conversación."] } },
    });
    expect(result.nextCursor).toContain('"offset":1');
  });

  it("fails closed when the source URL or page response leaves the authorized boundary", async () => {
    const never = vi.fn<typeof fetch>();
    const adapter = new ReadlangLinksAdapter({ fetch: never, policy });
    await expect(adapter.discover({ sourceStableKey: "readlang.links", externalSourceId: "https://readlang.com/es/library", cursor: null, limit: 1 })).rejects.toBeInstanceOf(ContentSourceAdapterError);
    expect(never).not.toHaveBeenCalled();

    const offPolicy = vi.fn<typeof fetch>(async () => response("<html><body><a href=\"https://attacker.example/one\">No</a></body></html>", { headers: { "content-type": "text/html" } }));
    const result = await new ReadlangLinksAdapter({ fetch: offPolicy, policy }).discover({ sourceStableKey: "readlang.links", externalSourceId: policy.sourceUrl, cursor: null, limit: 1 });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toContain('"offset":0');
    expect(offPolicy).toHaveBeenCalledTimes(3);
  });

  it("tries exact non-home URLs from the authorized snapshot even when the directory only lists homepages", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === policy.sourceUrl) {
        return response("<html><body><div id=\"app\"></div></body></html>", { headers: { "content-type": "text/html" } });
      }
      if (url === "https://readlang.com/api/popularDomains?language=es&limit=50") {
        return response(JSON.stringify([{ domainName: "news.example.test", path: "/" }]), {
          headers: { "content-type": "application/json" },
          url,
        });
      }
      expect(url).toBe("https://news.example.test/one");
      return response("<html><head><title>Una noticia autorizada</title></head><body><p>La biblioteca abre una sala nueva.</p></body></html>", {
        headers: { "content-type": "text/html" },
        url,
      });
    });
    const adapter = new ReadlangLinksAdapter({ fetch: fetchMock, policy, now: () => new Date("2026-09-18T00:00:00.000Z") });
    const result = await adapter.discover({ sourceStableKey: "readlang.links", externalSourceId: policy.sourceUrl, cursor: null, limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.canonicalUrl).toBe("https://news.example.test/one");
  });

  it("uses the fixed Readlang popular-domains API when the page is client-rendered", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === policy.sourceUrl) {
        return response("<html><body><div id=\"app\"></div></body></html>", { headers: { "content-type": "text/html" } });
      }
      if (url === "https://readlang.com/api/popularDomains?language=es&limit=50") {
        return response(JSON.stringify([{ domainName: "news.example.test", path: "/one" }, { domainName: "attacker.example", path: "/two" }]), {
          headers: { "content-type": "application/json; charset=utf-8" },
          url,
        });
      }
      expect(url).toBe("https://news.example.test/one");
      return response("<html><head><title>Una noticia</title></head><body><article><p>La biblioteca abre una sala nueva.</p></article></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
        url,
      });
    });
    const adapter = new ReadlangLinksAdapter({ fetch: fetchMock, policy, now: () => new Date("2026-09-18T00:00:00.000Z") });
    const result = await adapter.discover({ sourceStableKey: "readlang.links", externalSourceId: policy.sourceUrl, cursor: null, limit: 10 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.canonicalUrl).toBe("https://news.example.test/one");
    expect(result.nextCursor).toContain('"offset":1');
  });

  it("reads exact Readlang library URLs through the public book and chunk APIs", async () => {
    const libraryUrl = "https://readlang.com/library/abc123";
    const libraryPolicy = readlangLinksPolicySchema.parse({
      ...policy,
      allowlist: {
        ...policy.allowlist,
        hosts: ["readlang.com"],
        urls: [libraryUrl],
        urlPrefixes: ["https://readlang.com/es/links", "https://readlang.com/library/"],
      },
    });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === libraryPolicy.sourceUrl) {
        return response("<html><body><div id=\"app\"></div></body></html>", { headers: { "content-type": "text/html" } });
      }
      if (url === "https://readlang.com/api/popularDomains?language=es&limit=50") {
        return response("[]", { headers: { "content-type": "application/json" }, url });
      }
      if (url === "https://readlang.com/api/book/abc123") {
        return response(JSON.stringify({
          _id: "abc123",
          title: "Una historia breve",
          author: "Readlang Story Bot",
          language: "es",
          category: "Fiction",
          firstShareDate: "2026-09-19T00:00:00.000Z",
          metrics: { CEF: "B1" },
          htmlChunks: [{ sha1: "0123456789012345678901234567890123456789" }],
        }), { headers: { "content-type": "application/json" }, url });
      }
      expect(url).toBe("https://readlang.com/api/chunk/0123456789012345678901234567890123456789");
      return response("<p>Una persona camina por la ciudad y descubre una nueva historia.</p>", { headers: { "content-type": "text/plain" }, url });
    });
    const adapter = new ReadlangLinksAdapter({ fetch: fetchMock, policy: libraryPolicy, now: () => new Date("2026-09-19T00:00:00.000Z") });
    const result = await adapter.discover({ sourceStableKey: "readlang.links", externalSourceId: libraryPolicy.sourceUrl, cursor: null, limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      canonicalUrl: libraryUrl,
      metadata: { articleDraft: { title: "Una historia breve", cefr: "B1", format: "story", paragraphs: ["Una persona camina por la ciudad y descubre una nueva historia."] } },
    });
  });

  it("rejects a same-host redirect to an URL outside the snapshot", async () => {
    const redirecting = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === policy.sourceUrl) {
        return response('<html><body><a href="https://news.example.test/one">Uno</a></body></html>', { headers: { "content-type": "text/html" } });
      }
      return response(null, { status: 302, headers: { location: "https://news.example.test/not-authorized" }, url });
    });
    const result = await new ReadlangLinksAdapter({ fetch: redirecting, policy }).discover({ sourceStableKey: "readlang.links", externalSourceId: policy.sourceUrl, cursor: null, limit: 1 });
    expect(result.items).toEqual([]);
  });

  it("splits a long literary paragraph at a bounded word boundary", async () => {
    const longParagraph = `${"La literatura conserva la memoria de una ciudad. ".repeat(240)}`;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === policy.sourceUrl) {
        return response(`<html><body><a href="https://news.example.test/one">Obra</a></body></html>`, { headers: { "content-type": "text/html" } });
      }
      return response(`<html><head><title>Una obra larga</title></head><body><article><p>${longParagraph}</p></article></body></html>`, {
        headers: { "content-type": "text/html" },
        url,
      });
    });
    const result = await new ReadlangLinksAdapter({ fetch: fetchMock, policy, now: () => new Date("2026-09-19T00:00:00.000Z") }).discover({
      sourceStableKey: "readlang.links",
      externalSourceId: policy.sourceUrl,
      cursor: null,
      limit: 1,
    });
    expect(result.items).toHaveLength(1);
    const draft = result.items[0]?.metadata.articleDraft as { paragraphs?: readonly string[] } | undefined;
    expect(draft?.paragraphs?.every((paragraph) => paragraph.length <= 8_000)).toBe(true);
  });

  it("keeps source metadata, removes related-link noise, and preserves complete summaries", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === policy.sourceUrl) {
        return response('<html><body><a href="https://news.example.test/one">Uno</a></body></html>', { headers: { "content-type": "text/html" } });
      }
      return response(`<html><head>
        <title>Una noticia | Example</title>
        <meta name="author" content="Ana Pérez">
        <meta property="article:published_time" content="2026-09-19T05:13:22.506Z">
        <meta property="og:description" content="La noticia explica el cambio. La segunda frase también queda completa.">
      </head><body><article>
        <h1>Una noticia</h1>
        <p>La noticia explica el cambio. La segunda frase también queda completa.</p>
        <p>Artículo relacionado Otra noticia que no forma parte del cuerpo.</p>
        <p>El barrio organiza una conversación.</p>
      </article></body></html>`, { headers: { "content-type": "text/html" }, url });
    });
    const result = await new ReadlangLinksAdapter({ fetch: fetchMock, policy }).discover({
      sourceStableKey: "readlang.links",
      externalSourceId: policy.sourceUrl,
      cursor: null,
      limit: 1,
    });
    const draft = result.items[0]?.metadata.articleDraft as Record<string, unknown>;
    expect(draft).toMatchObject({
      title: "Una noticia",
      author: "Ana Pérez",
      publicationDate: "2026-09-19",
      summary: "La noticia explica el cambio. La segunda frase también queda completa.",
      paragraphs: ["La noticia explica el cambio. La segunda frase también queda completa.", "El barrio organiza una conversación."],
    });
  });
});
