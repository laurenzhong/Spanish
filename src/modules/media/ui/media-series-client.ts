import { z } from "zod";

import { mediaArtworkSchema, mediaStableKeySchema } from "../schemas/media";
import { mediaSeriesSummarySchema } from "../schemas/media-series";
import type { MediaSeriesEpisodes } from "../repositories/media-series-repository";

export const mediaSeriesCardSchema = z.object({
  id: z.string().min(1).max(250), stableKey: mediaStableKeySchema, version: z.number().int().positive(),
  kind: z.enum(["video", "podcast"]), title: z.string().min(1), summary: z.string(), sourceName: z.string(), language: z.string(),
  region: z.string().nullable(), cefr: z.enum(["A1", "A2", "B1", "B2"]).nullable(), topics: z.array(z.string()),
  durationMs: z.number().int().positive(), publishedAt: z.string().nullable(), curatedAt: z.string(), contentHash: z.string(),
  artwork: mediaArtworkSchema.nullable().optional(), series: mediaSeriesSummarySchema.nullable().optional(),
  progress: z.object({ lastPositionMs: z.number().int().nonnegative(), lastSegmentIndex: z.number().int().nonnegative().nullable(), status: z.enum(["in_progress", "completed"]), revision: z.number().int().positive() }).nullable(),
});
export const mediaSeriesViewSchema = mediaSeriesSummarySchema.omit({ seasonNumber: true, episodeNumber: true, episodeLabel: true }).extend({
  summary: z.string().max(1000), status: z.literal("active"), episodeCount: z.number().int().nonnegative(),
});
const episodesSchema = z.object({ apiVersion: z.literal("v1"), data: z.object({
  series: mediaSeriesViewSchema, items: z.array(mediaSeriesCardSchema).max(50),
  anchor: z.object({ current: mediaSeriesCardSchema.nullable(), previous: mediaSeriesCardSchema.nullable(), next: mediaSeriesCardSchema.nullable() }),
  nextCursor: z.string().min(1).max(2000).nullable(), hasMore: z.boolean(),
}) });

export class MediaSeriesReadError extends Error {
  constructor(readonly code: "unavailable" | "cursor-invalid" | "failed") { super(code); }
}

export async function requestMediaSeriesEpisodes(seriesKey: string, query: { cursor?: string; anchorMediaKey?: string }, signal: AbortSignal): Promise<MediaSeriesEpisodes> {
  const parameters = new URLSearchParams({ pageSize: "20" });
  if (query.cursor) parameters.set("cursor", query.cursor);
  else if (query.anchorMediaKey) parameters.set("anchorMediaKey", query.anchorMediaKey);
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  const request = async () => {
    const response = await fetch(`/api/v1/media-series/${encodeURIComponent(seriesKey)}/episodes?${parameters}`, { signal, cache: "no-store", credentials: "same-origin" });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { error?: { code?: string } } | null;
      throw new MediaSeriesReadError(response.status === 404 ? "unavailable" : error?.error?.code === "MEDIA_SERIES_CURSOR_INVALID" ? "cursor-invalid" : "failed");
    }
    const parsed = episodesSchema.safeParse(await response.json());
    if (!parsed.success) throw new MediaSeriesReadError("failed");
    const data = parsed.data.data;
    const allCards = [...data.items, data.anchor.current, data.anchor.previous, data.anchor.next].filter((item) => item !== null);
    if (data.series.seriesKey !== seriesKey || allCards.some((item) => item.kind !== data.series.kind || (item.series && item.series.seriesKey !== seriesKey))
      || new Set(data.items.map((item) => item.stableKey)).size !== data.items.length
      || data.hasMore !== Boolean(data.nextCursor)
      || (query.anchorMediaKey && data.anchor.current?.stableKey !== query.anchorMediaKey)) throw new MediaSeriesReadError("failed");
    return data;
  };
  try { return await Promise.race([request(), cancelled]); }
  finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
}
