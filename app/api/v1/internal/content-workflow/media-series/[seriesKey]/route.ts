import type { NextRequest } from "next/server";

import { saveMediaSeries } from "@/src/modules/media/application/media-series";
import { mediaSeriesRepository, readMediaSeriesCommandBody, withMediaSeriesUser } from "@/src/modules/media/http/series-http";
import { mediaSeriesKeySchema, saveMediaSeriesCommandSchema } from "@/src/modules/media/schemas/media-series";

export async function PUT(request: NextRequest, context: { params: Promise<{ seriesKey: string }> }) {
  return withMediaSeriesUser(request, async (ownerId) => {
    const seriesKey = mediaSeriesKeySchema.parse((await context.params).seriesKey);
    const command = saveMediaSeriesCommandSchema.parse(await readMediaSeriesCommandBody(request));
    return saveMediaSeries(mediaSeriesRepository(), seriesKey, command, ownerId);
  }, true);
}
