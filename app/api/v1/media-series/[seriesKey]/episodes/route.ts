import type { NextRequest } from "next/server";

import { listMediaSeriesEpisodes } from "@/src/modules/media/application/media-series";
import { mediaSeriesRepository, withMediaSeriesUser } from "@/src/modules/media/http/series-http";
import { mediaSeriesEpisodesQuerySchema, mediaSeriesKeySchema } from "@/src/modules/media/schemas/media-series";

export async function GET(request: NextRequest, context: { params: Promise<{ seriesKey: string }> }) {
  return withMediaSeriesUser(request, async (userId) => {
    const seriesKey = mediaSeriesKeySchema.parse((await context.params).seriesKey);
    const parameters = request.nextUrl.searchParams;
    const query = mediaSeriesEpisodesQuerySchema.parse({
      ...Object.fromEntries(parameters),
      pageSize: parameters.has("pageSize") ? Number(parameters.get("pageSize")) : undefined,
    });
    return listMediaSeriesEpisodes(mediaSeriesRepository(), seriesKey, query, userId);
  });
}
