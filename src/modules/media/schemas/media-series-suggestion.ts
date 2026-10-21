import { z } from "zod";

import { isSafeMediaSeriesAuditText, mediaSeriesMaximumRevision } from "../domain/media-series";
import { isPublicMediaSeriesSuggestionUrl, mediaSeriesSuggestionBases, mediaSeriesSuggestionWarnings } from "../domain/media-series-suggestion";
import { mediaStableKeySchema } from "./media";

const auditText = (maximum: number) => z.string().trim().min(1).max(maximum).refine(isSafeMediaSeriesAuditText);
const episodeNumber = z.number().int().min(0).max(mediaSeriesMaximumRevision).nullable().default(null);
const metadata = z.strictObject({
  sourceStableKey: mediaStableKeySchema,
  mediaStableKey: mediaStableKeySchema,
  kind: z.enum(["video", "podcast"]),
  basis: z.enum(mediaSeriesSuggestionBases),
  externalSeriesId: auditText(500),
  title: auditText(200),
  sourceUrl: z.string().trim().min(1).max(2000).refine(isPublicMediaSeriesSuggestionUrl).transform((value) => new URL(value).toString()),
  seasonNumber: episodeNumber,
  episodeNumber,
});
const compatibleBasis = (value: { basis: string; kind: string }) => value.basis !== "podcast_feed" || value.kind === "podcast";

export const mediaSeriesSuggestionInputSchema = metadata.extend({ metadataConflict: z.boolean().optional() }).refine(compatibleBasis);
export const mediaSeriesSuggestionSchema = metadata.extend({
  suggestionKey: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.literal("unconfirmed"),
  warnings: z.array(z.enum(mediaSeriesSuggestionWarnings)).max(2).refine((values) => new Set(values).size === values.length),
}).refine(compatibleBasis);
