import { z } from "zod";

import type { MediaSeriesRecommendations } from "../repositories/media-series-repository";
import { mediaSeriesCardSchema, mediaSeriesViewSchema } from "./media-series-client";

const responseSchema = z.object({ apiVersion: z.literal("v1"), data: z.object({
  series: mediaSeriesViewSchema.nullable(), items: z.array(mediaSeriesCardSchema).max(6),
}) });

/** Read-only request. Playback availability and series ownership remain server facts. */
export async function requestMediaSeriesRecommendations(stableKey: string, signal: AbortSignal): Promise<MediaSeriesRecommendations> {
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  async function request(): Promise<MediaSeriesRecommendations> {
    const response = await fetch(`/api/v1/media/${encodeURIComponent(stableKey)}/series-recommendations`, { signal, cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("MEDIA_SERIES_UNAVAILABLE");
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("MEDIA_SERIES_RESPONSE_INVALID");
    const { series, items } = parsed.data.data;
    if (!series) return { series: null, items: [] };
    if (series.kind !== "video" || new Set(items.map((item) => item.stableKey)).size !== items.length
      || items.some((item) => item.stableKey === stableKey || item.kind !== "video" || item.series?.seriesKey !== series.seriesKey)) {
      throw new Error("MEDIA_SERIES_RESPONSE_INVALID");
    }
    return { series, items };
  }
  try { return await Promise.race([request(), cancelled]); }
  finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
}
