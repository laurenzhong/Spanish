import type { MediaPlayback } from "../domain";

export const videoLearningE2eStableKey = "youtube.e2e-cafe";
export const nativeVideoLearningE2eStableKey = "video.e2e-native";

export function getVideoLearningE2eFixture(stableKey: string): MediaPlayback | null {
  const isYoutubeFixture = stableKey === videoLearningE2eStableKey;
  const isNativeFixture = stableKey === nativeVideoLearningE2eStableKey;
  if (process.env.NODE_ENV === "production" || process.env.AUTH_E2E_ENABLED !== "1" || (!isYoutubeFixture && !isNativeFixture)) {
    return null;
  }
  return {
    media: {
      id: `${stableKey}@1`,
      stableKey,
      version: 1,
      kind: "video",
      title: isNativeFixture ? "Una historia breve" : "Cómo pedir un café",
      summary: "Una conversación breve para practicar una petición cotidiana.",
      sourceName: isNativeFixture ? "Fuente licenciada de prueba" : "Canal autorizado de prueba",
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
      kind: isNativeFixture ? "video" : "official_embed",
      url: isNativeFixture ? "https://media.example.test/video/sample.mp4" : "https://www.youtube-nocookie.com/embed/e2eCafe1234?enablejsapi=1",
      expiresAt: null,
    },
    segments: [
      { id: "e2e-segment-0", index: 0, startMs: 0, endMs: 1_800, sourceText: "Buenos días.", translation: "早上好。", speaker: null, words: [
        { startMs: 0, endMs: 700, startOffset: 0, endOffset: 6, text: "Buenos" },
        { startMs: 700, endMs: 1_800, startOffset: 7, endOffset: 11, text: "días" },
      ] },
      { id: "e2e-segment-1", index: 1, startMs: 1_800, endMs: 4_250, sourceText: "Quería un café con leche.", translation: "我想要一杯拿铁。", speaker: null, words: [
        { startMs: 1_800, endMs: 2_200, startOffset: 0, endOffset: 6, text: "Quería" },
        { startMs: 2_200, endMs: 2_550, startOffset: 7, endOffset: 9, text: "un" },
        { startMs: 2_550, endMs: 3_150, startOffset: 10, endOffset: 14, text: "café" },
        { startMs: 3_150, endMs: 3_650, startOffset: 15, endOffset: 18, text: "con" },
        { startMs: 3_650, endMs: 4_250, startOffset: 19, endOffset: 24, text: "leche" },
      ] },
      { id: "e2e-segment-2", index: 2, startMs: 4_250, endMs: 6_000, sourceText: "Claro.", translation: "当然。", speaker: null, words: [
        { startMs: 4_250, endMs: 6_000, startOffset: 0, endOffset: 5, text: "Claro" },
      ] },
    ],
  };
}
