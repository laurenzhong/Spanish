// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ArticleCandidateValidationError,
  extractArticlePage,
  normalizeArticleCandidate,
} from "@/src/modules/content-acquisition";

const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "content-acquisition", "article-pages");

describe("article candidate normalization", () => {
  it("keeps plain-text paragraphs and strips executable or event-handler HTML", async () => {
    const html = await readFile(path.join(fixtureRoot, "malicious-article.html"), "utf8");
    const page = extractArticlePage(html, "https://news.example.test/inseguro", "2026-09-13T00:00:00.000Z");

    expect(page.paragraphs).toEqual([
      "Texto seguro para leer.",
      "Segundo párrafo & final.",
    ]);
    expect(JSON.stringify(page)).not.toMatch(/script|onclick|document\.cookie|display:\s*none/iu);
  });

  it("produces a deterministic hash and rejects missing body or incomplete rights metadata", () => {
    const base = {
      sourceStableKey: "news.example",
      externalItemId: "article-1",
      canonicalUrl: "https://news.example.test/article-1",
      title: "Una noticia",
      summary: "Resumen breve.",
      author: "María Ejemplo",
      publishedAt: "2026-09-12T06:30:00.000Z",
      fetchedAt: "2026-09-13T00:00:00.000Z",
      paragraphs: ["Primer párrafo.", "Segundo párrafo."],
      source: {
        sourceName: "Noticias de ejemplo",
        sourceType: "creative_commons" as const,
        license: "creative_commons" as const,
        attribution: "Noticias de ejemplo / CC BY 4.0",
        licenseEvidence: "https://news.example.test/licencia",
      },
      defaults: {
        cefr: "B1" as const,
        topics: ["topic.current-events"],
        region: "es-ES",
        register: "neutral",
        format: "news" as const,
        oralTransferType: "opinion" as const,
      },
    };

    const first = normalizeArticleCandidate(base);
    const second = normalizeArticleCandidate(structuredClone(base));
    expect(first).toEqual(second);
    expect(first.contentHash).toBe(first.metadata.articleDraft.contentHash);
    expect(first.metadata.articleDraft.stableKey).toMatch(/^article\.acquired\.[a-f0-9]{24}$/u);

    expect(() => normalizeArticleCandidate({ ...base, paragraphs: [] })).toThrow(ArticleCandidateValidationError);
    expect(() => normalizeArticleCandidate({
      ...base,
      source: { ...base.source, licenseEvidence: "" },
    })).toThrow(ArticleCandidateValidationError);
  });
});
