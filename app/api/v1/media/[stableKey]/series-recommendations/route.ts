import type { NextRequest } from "next/server";

import { getMediaSeriesRecommendations } from "@/src/modules/media/application/media-series";
import { mediaSeriesRepository, withMediaSeriesUser } from "@/src/modules/media/http/series-http";
import { mediaStableKeySchema } from "@/src/modules/media/schemas/media";

export async function GET(request: NextRequest, context: { params: Promise<{ stableKey: string }> }) {
  return withMediaSeriesUser(request, async (userId) => {
    const stableKey = mediaStableKeySchema.parse((await context.params).stableKey);
    return getMediaSeriesRecommendations(mediaSeriesRepository(), stableKey, userId);
  });
}
