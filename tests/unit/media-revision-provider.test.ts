// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createPodcastCandidateDraft, MiniMaxMediaRevisionProvider } from "@/src/modules/content-acquisition";

function draft() {
  return createPodcastCandidateDraft({
    stableKey: "podcast.episode42",
    feedUrl: "https://podcast.example.test/feed.xml",
    episodeGuid: "episode-42",
    canonicalUrl: "https://podcast.example.test/episodes/42",
    enclosureUrl: "https://media.example.test/episode-42.mp3",
    enclosureMimeType: "audio/mpeg",
    enclosureByteSize: 128,
    playbackExpiresAt: "2026-09-30T10:00:00.000Z",
    title: "Una mañana en el mercado",
    summary: "Una charla breve.",
    sourceName: "Café de cada día",
    language: "es",
    region: "es-ES",
    cefr: "A2",
    topics: ["topic.daily-life"],
    durationMs: 360_000,
    publicationDate: "2026-09-13T08:00:00.000Z",
    fetchedAt: "2026-09-14T10:00:00.000Z",
    license: "licensed",
    attribution: "Café de cada día",
    licenseEvidence: "https://podcast.example.test/license",
    copyrightStatus: "cleared",
    transcriptStatus: "unavailable",
    transcriptUrl: null,
    segments: [],
    changeReason: "Reviewed podcast candidate.",
  });
}

describe("MiniMax media revision response boundary", () => {
  it("treats an empty optional changeReason as absent", async () => {
    const provider = new MiniMaxMediaRevisionProvider({
      apiKey: "test-key",
      fetchImplementation: async () => new Response(JSON.stringify({
        content: [{ type: "text", text: JSON.stringify({ summary: "Resumen corregido.", changeReason: "" }) }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });

    await expect(provider.revise({
      candidateId: "candidate-1",
      candidateRevision: 1,
      contentType: "podcast",
      contentHash: draft().contentHash,
      title: draft().title,
      summary: draft().summary,
      draft: draft(),
      feedback: [{ dimension: "content-es-ES", notes: "Corrige el resumen." }],
    })).resolves.toMatchObject({ summary: "Resumen corregido." });
  });
});
