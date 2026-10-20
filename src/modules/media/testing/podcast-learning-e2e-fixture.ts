import type { MediaPlayback } from "../domain";
import { getMediaSeriesE2eSummary } from "./media-series-e2e-fixture";

export const podcastLearningE2eStableKey = "podcast.e2e-cafe";
export const longPodcastLearningE2eStableKey = "podcast.e2e-long-transcript";
export const loadingPodcastLearningE2eStableKey = "podcast.e2e-loading";

export async function waitForPodcastLearningE2eFixture(stableKey: string): Promise<void> {
  if (process.env.NODE_ENV !== "production" && process.env.AUTH_E2E_ENABLED === "1"
    && stableKey === loadingPodcastLearningE2eStableKey) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

export function getPodcastLearningE2eFixture(stableKey: string): MediaPlayback | null {
  if (process.env.NODE_ENV === "production" || process.env.AUTH_E2E_ENABLED !== "1") {
    return null;
  }
  if (stableKey === "podcast.e2e-series-01" || stableKey === "podcast.e2e-series-03") {
    const base = getPodcastLearningE2eFixture(podcastLearningE2eStableKey)!;
    const series = getMediaSeriesE2eSummary(stableKey);
    return { ...base, media: { ...base.media, id: `${stableKey}@1`, stableKey, series, title: `Una conversación en el mercado · ${series!.episodeNumber}` } };
  }
  if (stableKey === loadingPodcastLearningE2eStableKey) {
    const base = getPodcastLearningE2eFixture(podcastLearningE2eStableKey)!;
    return { ...base, media: { ...base.media, id: `${stableKey}@1`, stableKey, series: null } };
  }
  if (stableKey === longPodcastLearningE2eStableKey) {
    const base = getPodcastLearningE2eFixture(podcastLearningE2eStableKey)!;
    return {
      ...base,
      media: { ...base.media, id: `${stableKey}@1`, stableKey, durationMs: 108_000, series: null },
      segments: Array.from({ length: 36 }, (_, index) => ({
        ...base.segments[index % base.segments.length]!,
        id: `podcast-long-${index}`, index, startMs: index * 3_000, endMs: (index + 1) * 3_000,
        words: null,
      })),
    };
  }
  if (stableKey !== podcastLearningE2eStableKey) return null;
  return {
    media: {
      id: `${podcastLearningE2eStableKey}@1`,
      stableKey: podcastLearningE2eStableKey,
      version: 1,
      kind: "podcast",
      title: "Una mañana en el mercado",
      summary: "Un episodio breve para escuchar una compra cotidiana.",
      sourceName: "Café de cada día · prueba autorizada",
      language: "es",
      region: "es-ES",
      cefr: "A2",
      topics: ["topic.daily-life"],
      durationMs: 7_000,
      publishedAt: "2026-09-14T08:00:00.000Z",
      curatedAt: "2026-09-14T10:00:00.000Z",
      contentHash: "b".repeat(64),
      progress: { lastPositionMs: 0, lastSegmentIndex: 0, status: "in_progress", revision: 0 },
      series: getMediaSeriesE2eSummary(stableKey),
    },
    asset: {
      kind: "audio",
      url: "https://media.example.test/audio/podcast-sample.mp3",
      expiresAt: "2026-09-21T10:00:00.000Z",
    },
    segments: [
      // Same as the video fixture: real imported transcripts carry S1/S2
      // diarization indexes, and the subtitle list must not print them.
      { id: "podcast-e2e-0", index: 0, startMs: 0, endMs: 2_200, sourceText: "Buenos días, ¿qué te pongo?", translation: "早上好，你要买点什么？", speaker: "S1", words: [
        { startMs: 0, endMs: 550, startOffset: 0, endOffset: 6, text: "Buenos" },
        { startMs: 550, endMs: 850, startOffset: 7, endOffset: 11, text: "días" },
        { startMs: 850, endMs: 1_150, startOffset: 14, endOffset: 17, text: "qué" },
        { startMs: 1_150, endMs: 1_450, startOffset: 18, endOffset: 20, text: "te" },
        { startMs: 1_450, endMs: 2_200, startOffset: 21, endOffset: 26, text: "pongo" },
      ] },
      { id: "podcast-e2e-1", index: 1, startMs: 2_200, endMs: 5_000, sourceText: "Quería medio kilo de naranjas, por favor.", translation: "我想要半公斤橙子，谢谢。", speaker: "S2", words: [
        { startMs: 2_200, endMs: 2_600, startOffset: 0, endOffset: 6, text: "Quería" },
        { startMs: 2_600, endMs: 3_000, startOffset: 7, endOffset: 12, text: "medio" },
        { startMs: 3_000, endMs: 3_350, startOffset: 13, endOffset: 17, text: "kilo" },
        { startMs: 3_350, endMs: 3_650, startOffset: 18, endOffset: 20, text: "de" },
        { startMs: 3_650, endMs: 4_200, startOffset: 21, endOffset: 29, text: "naranjas" },
        { startMs: 4_200, endMs: 4_550, startOffset: 31, endOffset: 34, text: "por" },
        { startMs: 4_550, endMs: 5_000, startOffset: 35, endOffset: 40, text: "favor" },
      ] },
      { id: "podcast-e2e-2", index: 2, startMs: 5_000, endMs: 7_000, sourceText: "Claro, ahora mismo.", translation: "当然，马上来。", speaker: null, words: [
        { startMs: 5_000, endMs: 5_650, startOffset: 0, endOffset: 5, text: "Claro" },
        { startMs: 5_650, endMs: 6_250, startOffset: 7, endOffset: 12, text: "ahora" },
        { startMs: 6_250, endMs: 7_000, startOffset: 13, endOffset: 18, text: "mismo" },
      ] },
    ],
  };
}
