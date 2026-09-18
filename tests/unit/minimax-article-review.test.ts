import { describe, expect, it } from "vitest";

import {
  articleReviewInputHash,
  createConfiguredArticleReviewProviders,
  MiniMaxArticleReviewProvider,
  type ArticleReviewInput,
} from "@/src/modules/content-acquisition/providers/article-review";

const input: ArticleReviewInput = {
  candidateId: "candidate-minimax",
  candidateRevision: 4,
  contentHash: "a".repeat(64),
  title: "Una noticia breve",
  summary: "Un resumen breve.",
  paragraphs: ["El texto de prueba."],
  draft: {
    stableKey: "article.minimax",
    locale: "es-ES",
    title: "Una noticia breve",
    summary: "Un resumen breve.",
    author: null,
    canonicalUrl: "https://example.test/article",
    publicationDate: "2026-09-18",
    sourceName: "Fuente",
    sourceType: "licensed",
    license: "licensed",
    attribution: "Fuente",
    licenseEvidence: "https://example.test/license",
    copyrightStatus: "cleared",
    fetchedAt: "2026-09-18T00:00:00.000Z",
    contentHash: "a".repeat(64),
    cefr: "B1",
    topics: ["daily-life"],
    region: "ES",
    register: "neutral",
    format: "news",
    estimatedReadingMinutes: 1,
    oralTransferType: "summary",
    paragraphs: ["El texto de prueba."],
    changeReason: "Fixture.",
  },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "review-1" },
  });
}

describe("MiniMax article review provider", () => {
  it("returns a validated decision bound to the frozen input hash", async () => {
    let requestInit: RequestInit | undefined;
    let calls = 0;
    const fetchImplementation = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requestInit = init;
      calls += 1;
      return response({ content: [{ type: "text", text: JSON.stringify({ decision: "approved", notes: "Contenido claro." }) }] });
    };
    const provider = new MiniMaxArticleReviewProvider("content-es-ES", {
      apiKey: "test-minimax-key",
      endpoint: "https://minimax.test/anthropic/v1/messages",
      fetchImplementation,
      clock: () => 100,
    });

    await expect(provider.review(input)).resolves.toEqual({
      decision: "approved",
      notes: "Contenido claro.",
      modelVersion: "MiniMax-M3/content-es-ES",
      inputHash: articleReviewInputHash(input),
    });
    expect(calls).toBe(1);
    expect((requestInit?.headers as Record<string, string>)["x-api-key"]).toBe("test-minimax-key");
    expect(JSON.stringify(JSON.parse(String(requestInit?.body)))).toContain("candidate-minimax");
  });

  it("fails closed when the provider returns non-JSON output", async () => {
    const provider = new MiniMaxArticleReviewProvider("teaching-zh-CN", {
      apiKey: "test-minimax-key",
      fetchImplementation: async () => response({ content: [{ type: "text", text: "not json" }] }),
    });

    await expect(provider.review(input)).rejects.toThrow("ARTICLE_REVIEW_PROVIDER_RESPONSE_INVALID");
  });

  it("uses MiniMax as the configured production provider and rejects an unconfigured key", () => {
    expect(() => createConfiguredArticleReviewProviders({ provider: "minimax", apiKey: "" })).toThrow("ARTICLE_REVIEW_MINIMAX_NOT_CONFIGURED");
    const providers = createConfiguredArticleReviewProviders({ provider: "minimax", apiKey: "configured" });
    expect(providers.content).toBeInstanceOf(MiniMaxArticleReviewProvider);
    expect(providers.teaching).toBeInstanceOf(MiniMaxArticleReviewProvider);
  });
});
