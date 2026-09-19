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
});
