import { createHash } from "node:crypto";

import { MediaUnavailableError, type MediaCard } from "../domain/media";
import { MediaSeriesError, type MediaSeriesSummary } from "../domain/media-series";
import type { MediaSeriesRepository, MediaSeriesView } from "../repositories/media-series-repository";

export const videoSeriesE2eKey = "series.e2e-video";
export const podcastSeriesE2eKey = "series.e2e-podcast";
export const emptySeriesE2eKey = "series.e2e-empty";
export const archivedSeriesE2eKey = "series.e2e-archived";
const videoKeys = [
  ...Array.from({ length: 23 }, (_, index) => `video.e2e-series-${String(index + 1).padStart(2, "0")}`),
  "video.e2e-native", "youtube.e2e-cafe",
];
const podcastKeys = ["podcast.e2e-series-01", "podcast.e2e-cafe", "podcast.e2e-series-03"];

function enabled() {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_E2E_ENABLED === "1";
}

function assertEnabled() {
  if (!enabled()) throw new MediaSeriesError("MEDIA_SERIES_UNAVAILABLE");
}

function series(seriesKey: string): MediaSeriesView {
  assertEnabled();
  const kind = seriesKey === podcastSeriesE2eKey ? "podcast" : "video";
  if (![videoSeriesE2eKey, podcastSeriesE2eKey, emptySeriesE2eKey].includes(seriesKey)) {
    throw new MediaSeriesError("MEDIA_SERIES_NOT_AVAILABLE");
  }
  return {
    seriesKey, title: kind === "video" ? "Conversaciones cotidianas · serie de prueba" : "Café de cada día · serie de prueba",
    summary: "Contenido de prueba para verificar la navegación entre episodios.",
    kind, orderMode: "ordered", status: "active", revision: 1,
    episodeCount: seriesKey === emptySeriesE2eKey ? 0 : kind === "video" ? videoKeys.length : podcastKeys.length,
  };
}

export function getMediaSeriesE2eSummary(stableKey: string): MediaSeriesSummary | null {
  if (!enabled()) return null;
  const videoIndex = videoKeys.indexOf(stableKey);
  const podcastIndex = podcastKeys.indexOf(stableKey);
  if (videoIndex < 0 && podcastIndex < 0) return null;
  const descriptor = series(videoIndex >= 0 ? videoSeriesE2eKey : podcastSeriesE2eKey);
  const episodeNumber = (videoIndex >= 0 ? videoIndex : podcastIndex) + 1;
  return {
    seriesKey: descriptor.seriesKey, title: descriptor.title, kind: descriptor.kind,
    orderMode: descriptor.orderMode, revision: descriptor.revision,
    seasonNumber: 1, episodeNumber, episodeLabel: `Episodio ${episodeNumber}`,
  };
}

/** Narrow cards are built independently of playback fixtures and their transcripts. */
export function getMediaSeriesE2eCard(stableKey: string, userId?: string): MediaCard | null {
  const summary = getMediaSeriesE2eSummary(stableKey);
  if (!summary) return null;
  const title = stableKey === "youtube.e2e-cafe" ? "Cómo pedir un café"
    : stableKey === "video.e2e-native" ? "Una historia breve"
      : stableKey === "podcast.e2e-cafe" ? "Una mañana en el mercado"
        : `${summary.kind === "video" ? "Una historia breve" : "Una conversación en el mercado"} · ${summary.episodeNumber}`;
  return {
    id: `${stableKey}@1`, stableKey, version: 1, kind: summary.kind, title,
    summary: "Contenido de prueba para la navegación del catálogo.",
    sourceName: summary.kind === "video" ? "Fuente licenciada de prueba" : "Café de cada día · prueba autorizada",
    language: "es", region: "es-ES", cefr: "A2", topics: ["topic.daily-life"],
    durationMs: summary.kind === "video" ? 6000 : 7000,
    publishedAt: "2026-09-14T08:00:00.000Z", curatedAt: "2026-09-14T10:00:00.000Z",
    contentHash: (summary.kind === "video" ? "a" : "b").repeat(64), series: summary,
    progress: stableKey === "video.e2e-series-01" && userId
      ? { lastPositionMs: userId.endsWith("2") ? 2000 : 1000, lastSegmentIndex: 0, status: "in_progress", revision: 1 }
      : null,
  };
}

export function createMediaSeriesE2eRepository(): MediaSeriesRepository | null {
  if (!enabled()) return null;
  function cards(seriesKey: string, userId: string) {
    const descriptor = series(seriesKey);
    const keys = seriesKey === emptySeriesE2eKey ? [] : descriptor.kind === "video" ? videoKeys : podcastKeys;
    return { descriptor, items: keys.map((key) => getMediaSeriesE2eCard(key, userId)!) };
  }
  return {
    async getSeries(seriesKey) { return series(seriesKey); },
    async listEpisodes(seriesKey, query, userId) {
      const { descriptor, items } = cards(seriesKey, userId);
      const signature = createHash("sha256").update(JSON.stringify([seriesKey, descriptor.revision, query.pageSize, items.map((item) => item.id)])).digest("hex");
      const anchorIndex = query.anchorMediaKey ? items.findIndex((item) => item.stableKey === query.anchorMediaKey) : -1;
      if (query.anchorMediaKey && anchorIndex < 0) throw new MediaSeriesError("MEDIA_SERIES_QUERY_INVALID");
      let offset = anchorIndex < 0 ? 0 : Math.floor(anchorIndex / query.pageSize) * query.pageSize;
      if (query.cursor) {
        try {
          const cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
          if (cursor.context !== signature || !Number.isSafeInteger(cursor.offset) || cursor.offset <= 0 || cursor.offset >= items.length) throw new Error();
          offset = cursor.offset;
        } catch { throw new MediaSeriesError("MEDIA_SERIES_CURSOR_INVALID"); }
      }
      const page = items.slice(offset, offset + query.pageSize);
      const end = offset + page.length;
      const hasMore = end < items.length;
      return {
        series: descriptor, items: page,
        anchor: {
          current: anchorIndex >= 0 ? items[anchorIndex] : null,
          previous: anchorIndex > 0 ? items[anchorIndex - 1] : null,
          next: anchorIndex >= 0 && anchorIndex < items.length - 1 ? items[anchorIndex + 1] : null,
        },
        nextCursor: hasMore ? Buffer.from(JSON.stringify({ context: signature, offset: end })).toString("base64url") : null,
        hasMore,
      };
    },
    async recommendations(stableKey, userId) {
      assertEnabled();
      const summary = getMediaSeriesE2eSummary(stableKey);
      if (!summary) {
        if (["video.e2e-long-transcript", "video.e2e-complete-transcript", "podcast.e2e-long-transcript", "podcast.e2e-loading"].includes(stableKey)) return { series: null, items: [] };
        throw new MediaUnavailableError();
      }
      if (summary.kind !== "video") return { series: null, items: [] };
      const { descriptor, items } = cards(summary.seriesKey, userId);
      const index = items.findIndex((item) => item.stableKey === stableKey);
      return { series: descriptor, items: [...items.slice(index + 1), ...items.slice(0, index)].slice(0, 6) };
    },
    async save() {
      // E2E reads must never make an owner write appear successful.
      throw new MediaSeriesError("MEDIA_SERIES_UNAVAILABLE");
    },
  };
}
