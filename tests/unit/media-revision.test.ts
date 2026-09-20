import { describe, expect, it } from "vitest";

import { createVideoCandidateDraft } from "@/src/modules/content-acquisition/normalizers";
import { FakeMediaRevisionProvider, MiniMaxMediaRevisionProvider, mergeMediaRevision } from "@/src/modules/content-acquisition/providers/media-revision";

const draft = createVideoCandidateDraft({
  stableKey: "youtube.demo.revision",
  platform: "youtube",
  platformVideoId: "revision1",
  sourceChannelId: "UC1234567890123456789012",
  canonicalUrl: "https://www.youtube.com/watch?v=revision1",
  embedUrl: "https://www.youtube-nocookie.com/embed/revision1?enablejsapi=1",
  title: "Un vídeo breve",
  summary: "Un resumen con enlaces promocionales.",
  sourceName: "Fuente autorizada",
  language: "es",
  region: "es-ES",
  cefr: "A2",
  topics: ["topic.media"],
  durationMs: 60_000,
  publicationDate: "2026-09-19T00:00:00.000Z",
  fetchedAt: "2026-09-19T01:00:00.000Z",
  license: "licensed",
  attribution: "Fuente autorizada",
  licenseEvidence: "https://example.test/license",
  copyrightStatus: "cleared",
  captionStatus: "unavailable",
  segments: [],
  changeReason: "fixture",
});

describe("media revision", () => {
  it("changes only mutable metadata and recalculates the content hash", async () => {
    const provider = new FakeMediaRevisionProvider();
    const payload = await provider.revise({
      candidateId: "candidate-1",
      candidateRevision: 2,
      contentType: "video",
      draft,
      feedback: [{ dimension: "teaching-zh-CN", notes: "Replace the promotional summary." }],
    });
    const revised = mergeMediaRevision(draft, { ...payload, summary: "Una explicación breve para estudiantes." });
    expect(revised).toMatchObject({
      stableKey: draft.stableKey,
      canonicalUrl: draft.canonicalUrl,
      summary: "Una explicación breve para estudiantes.",
      platformVideoId: draft.platformVideoId,
      embedUrl: draft.embedUrl,
    });
    expect(revised.contentHash).not.toBe(draft.contentHash);
  });

  it("does not accept immutable field changes from a revision payload", () => {
    expect(() => mergeMediaRevision(draft, { title: "Nuevo título", summary: "Descripción", changeReason: "repair" })).not.toThrow();
    expect(draft.canonicalUrl).toBe("https://www.youtube.com/watch?v=revision1");
  });

  it("retries a malformed provider response once", async () => {
    let calls = 0;
    const provider = new MiniMaxMediaRevisionProvider({
      apiKey: "test-key",
      timeoutMs: 100,
      fetchImplementation: async () => {
        calls += 1;
        const text = calls === 1
          ? "not-json"
          : JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ summary: "Una explicación breve.", changeReason: "repair" }) }] });
        return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    await expect(provider.revise({
      candidateId: "candidate-1",
      candidateRevision: 2,
      contentType: "video",
      draft,
      feedback: [{ dimension: "teaching-zh-CN", notes: "Improve the summary." }],
    })).resolves.toMatchObject({ summary: "Una explicación breve." });
    expect(calls).toBe(2);
  });
});
