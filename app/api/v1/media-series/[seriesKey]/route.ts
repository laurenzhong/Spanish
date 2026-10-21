import type { NextRequest } from "next/server";

import { getMediaSeries } from "@/src/modules/media/application/media-series";
import { mediaSeriesRepository, withMediaSeriesUser } from "@/src/modules/media/http/series-http";
import { mediaSeriesKeySchema } from "@/src/modules/media/schemas/media-series";

export async function GET(request: NextRequest, context: { params: Promise<{ seriesKey: string }> }) {
  return withMediaSeriesUser(request, async (userId) => {
    const seriesKey = mediaSeriesKeySchema.parse((await context.params).seriesKey);
    return getMediaSeries(mediaSeriesRepository(), seriesKey, userId);
  });
}
