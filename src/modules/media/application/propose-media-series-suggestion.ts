import { createHash } from "node:crypto";

import { mediaSeriesSuggestionIdentity, warningsForMediaSeriesSuggestion, type MediaSeriesSuggestion } from "../domain/media-series-suggestion";
import { mediaSeriesSuggestionInputSchema, mediaSeriesSuggestionSchema } from "../schemas/media-series-suggestion";

/** Only an unconfirmed candidate metadata proposal; never writes the catalogue or publishes. */
export function proposeMediaSeriesSuggestion(input: unknown): MediaSeriesSuggestion | null {
  const parsed = mediaSeriesSuggestionInputSchema.safeParse(input);
  if (!parsed.success) return null;
  const { metadataConflict, ...metadata } = parsed.data;
  const suggestion = mediaSeriesSuggestionSchema.safeParse({
    ...metadata,
    suggestionKey: createHash("sha256").update(JSON.stringify(mediaSeriesSuggestionIdentity(parsed.data))).digest("hex"),
    status: "unconfirmed",
    warnings: warningsForMediaSeriesSuggestion({ ...metadata, metadataConflict }),
  });
  return suggestion.success ? suggestion.data : null;
}
