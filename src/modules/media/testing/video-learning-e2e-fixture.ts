import type { MediaPlayback } from "../domain";

export const videoLearningE2eStableKey = "youtube.e2e-cafe";
export const hostedVideoLearningE2eStableKey = "video.e2e-hosted";

export function getVideoLearningE2eFixture(stableKey: string): MediaPlayback | null {
  if (process.env.NODE_ENV === "production" || process.env.AUTH_E2E_ENABLED !== "1" || ![videoLearningE2eStableKey, hostedVideoLearningE2eStableKey].includes(stableKey)) {
    return null;
  }
  return {
    media: {
      id: `${stableKey}@1`,
      stableKey,
      version: 1,
      kind: "video",
      title: "Cómo pedir un café",
      summary: "Una conversación breve para practicar una petición cotidiana.",
      sourceName: "Canal autorizado de prueba",
      language: "es",
      region: "es-ES",
      cefr: "A2",
      topics: ["topic.daily-life"],
      durationMs: 6_000,
      publishedAt: "2026-09-13T08:00:00.000Z",
      curatedAt: "2026-09-13T12:00:00.000Z",
      contentHash: "a".repeat(64),
      progress: { lastPositionMs: 0, lastSegmentIndex: 0, status: "in_progress", revision: 0 },
    },
    asset: {
      kind: stableKey === hostedVideoLearningE2eStableKey ? "video" : "official_embed",
      url: stableKey === hostedVideoLearningE2eStableKey ? "https://media.example.test/media/video.e2e-hosted/1/video.mp4" : "https://www.youtube-nocookie.com/embed/e2eCafe1234?enablejsapi=1",
      expiresAt: null,
    },
    segments: [
      { id: "e2e-segment-0", index: 0, startMs: 0, endMs: 1_800, sourceText: "Buenos días.", translation: "早上好。", speaker: null },
      { id: "e2e-segment-1", index: 1, startMs: 1_800, endMs: 4_250, sourceText: "Quería un café con leche.", translation: "我想要一杯拿铁。", speaker: null },
      { id: "e2e-segment-2", index: 2, startMs: 4_250, endMs: 6_000, sourceText: "Claro.", translation: "当然。", speaker: null },
    ],
  };
}
