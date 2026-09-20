import { describe, expect, it } from "vitest";

import { articleCandidateDraftSchema } from "@/src/modules/content-acquisition/normalizers";
import { FakeArticleRevisionProvider, MiniMaxArticleRevisionProvider, mergeArticleRevision } from "@/src/modules/content-acquisition/providers/article-revision";

const draft = articleCandidateDraftSchema.parse({
  stableKey: "article.acquired.fixture",
  locale: "es-ES",
  title: "Una noticia breve",
  summary: "Un resumen para la prueba.",
  author: null,
  canonicalUrl: "https://example.test/article",
  publicationDate: "2026-09-18",
  sourceName: "Fixture",
  sourceType: "licensed",
  license: "licensed",
  attribution: "Fixture",
  licenseEvidence: "https://example.test/license",
  copyrightStatus: "cleared",
  fetchedAt: "2026-09-18T00:00:00.000Z",
  contentHash: "a".repeat(64),
  cefr: "B1",
  topics: ["topic.news"],
  region: "ES",
  register: "journalistic",
  format: "news",
  estimatedReadingMinutes: 1,
  oralTransferType: "summary",
  paragraphs: ["El texto de la prueba."],
  changeReason: "Fixture.",
});

describe("article revision", () => {
  it("recomputes the immutable content hash while retaining source rights fields", () => {
    const revised = mergeArticleRevision(draft, {
      title: "Una noticia corregida",
      summary: "Un resumen corregido.",
      author: null,
      publicationDate: draft.publicationDate,
      cefr: "B1",
      topics: draft.topics,
      region: draft.region,
      register: draft.register,
      format: draft.format,
      estimatedReadingMinutes: 1,
      oralTransferType: "summary",
      paragraphs: ["El texto corregido."],
      changeReason: "Se corrigió una errata.",
    });
    expect(revised.contentHash).not.toBe(draft.contentHash);
    expect(revised.sourceName).toBe(draft.sourceName);
    expect(revised.licenseEvidence).toBe(draft.licenseEvidence);
  });

  it("keeps the fixture revision bounded to the supplied draft", async () => {
    const provider = new FakeArticleRevisionProvider();
    const result = await provider.revise({
      candidateId: "candidate-1",
      candidateRevision: 2,
      draft,
      feedback: [{ dimension: "content-es-ES", status: "changes_requested", notes: "Corrige una errata." }],
    });
    expect(result.paragraphs).toEqual(draft.paragraphs);
    expect(result.changeReason).toContain("1 review finding");
  });

  it("does not erase draft metadata when an optional provider hint is normalized away", () => {
    const revised = mergeArticleRevision(draft, {
      oralTransferType: undefined,
      changeReason: "Se corrigió una errata.",
    });
    expect(revised.oralTransferType).toBe(draft.oralTransferType);
    expect(revised.cefr).toBe(draft.cefr);
    expect(revised.format).toBe(draft.format);
  });

  it("retries a malformed provider response once", async () => {
    let calls = 0;
    const provider = new MiniMaxArticleRevisionProvider({
      apiKey: "test-key",
      timeoutMs: 100,
      fetchImplementation: async () => {
        calls += 1;
        const text = calls === 1
          ? "not-json"
          : JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ summary: "Un resumen corregido.", changeReason: "repair" }) }] });
        return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    await expect(provider.revise({
      candidateId: "candidate-1",
      candidateRevision: 2,
      draft,
      feedback: [{ dimension: "content-es-ES", status: "changes_requested", notes: "Corrige una errata." }],
    })).resolves.toMatchObject({ summary: "Un resumen corregido." });
    expect(calls).toBe(2);
  });
});
