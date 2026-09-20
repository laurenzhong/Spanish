// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createVideoCandidateDraft } from "@/src/modules/content-acquisition/normalizers";
import { MiniMaxMediaReviewProvider, mediaReviewInputHash } from "@/src/modules/content-acquisition/providers/media-review";

function input() {
  const draft = createVideoCandidateDraft({
    stableKey: "youtube.review-length",
    platform: "youtube",
    platformVideoId: "reviewLength1",
    sourceChannelId: "UCabcdefghijklmnopqrstuv",
    canonicalUrl: "https://www.youtube.com/watch?v=reviewLength1",
    embedUrl: "https://www.youtube-nocookie.com/embed/reviewLength1?enablejsapi=1",
    title: "Una conversación breve",
    summary: "Una conversación breve.",
    sourceName: "Español con calma",
    language: "es",
    region: "es-ES",
    cefr: "A2",
    topics: ["topic.daily-life"],
    durationMs: 60_000,
    publicationDate: "2026-09-13T08:00:00.000Z",
    fetchedAt: "2026-09-13T10:00:00.000Z",
    license: "licensed",
    attribution: "Español con calma en YouTube",
    licenseEvidence: "https://www.youtube.com/t/terms",
    copyrightStatus: "cleared",
    captionStatus: "platform_manual",
    segments: [{ index: 0, startMs: 0, endMs: 1_000, sourceText: "Hola.", translation: "你好。", speaker: null, confidence: null, sourceKind: "platform_manual" }],
    changeReason: "Review provider regression.",
  });
  return {
    candidateId: "candidate-review-length",
    candidateRevision: 1,
    contentHash: draft.contentHash,
    contentType: "video" as const,
    title: draft.title,
    summary: draft.summary,
    draft,
  };
}

describe("MiniMax media review provider", () => {
  it("keeps a valid decision when provider notes exceed the persisted note limit", async () => {
    const reviewInput = input();
    const longNotes = "detalle ".repeat(1_000);
    const fetchImplementation: typeof fetch = async () => new Response(JSON.stringify({
      content: [{ type: "text", text: JSON.stringify({ decision: "approved", notes: longNotes }) }],
    }), { status: 200, headers: { "content-type": "application/json" } });
    const provider = new MiniMaxMediaReviewProvider("content-es-ES", {
      apiKey: "test-key",
      fetchImplementation,
    });

    const result = await provider.review(reviewInput);

    expect(result).toMatchObject({ decision: "approved", inputHash: mediaReviewInputHash(reviewInput) });
    expect(result.notes).toHaveLength(4_000);
  });
});
