import { proposeMediaSeriesSuggestion } from "@/src/modules/media/application/propose-media-series-suggestion";

type Suggestion = ReturnType<typeof proposeMediaSeriesSuggestion>;

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replace(/\s+/gu, " ")).filter(Boolean))];
}

function episodeNumber(values: readonly string[]): Readonly<{ value: number | null; conflict: boolean }> {
  const normalized = uniqueText(values);
  if (normalized.length === 0) return { value: null, conflict: false };
  const numbers = normalized.map((value) => /^\d+$/u.test(value) ? Number(value) : Number.NaN);
  if (numbers.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647)
    || new Set(numbers).size !== 1) return { value: null, conflict: true };
  return { value: numbers[0], conflict: false };
}

/** Feed metadata is a review hint, never proof of membership or publication approval. */
export function suggestRssPodcastSeries(input: Readonly<{
  sourceStableKey: string;
  mediaStableKey: string;
  feedUrl: string;
  registeredProgramName: string;
  channelTitles: readonly string[];
  seasons: readonly string[];
  episodes: readonly string[];
}>): Suggestion {
  const titles = uniqueText(input.channelTitles);
  if (titles.length === 0) return null;
  const season = episodeNumber(input.seasons);
  const episode = episodeNumber(input.episodes);
  const registeredTitle = uniqueText([input.registeredProgramName])[0];
  return proposeMediaSeriesSuggestion({
    sourceStableKey: input.sourceStableKey,
    mediaStableKey: input.mediaStableKey,
    kind: "podcast",
    basis: "podcast_feed",
    externalSeriesId: input.feedUrl,
    title: titles[0],
    sourceUrl: input.feedUrl,
    seasonNumber: season.value,
    episodeNumber: episode.value,
    metadataConflict: titles.length > 1 || season.conflict || episode.conflict
      || Boolean(registeredTitle && registeredTitle !== titles[0]),
  });
}

/** A mixed acquisition directory is provenance; only the explicit public show ID supplies identity. */
export function suggestLanguageReactorPodcastSeries(input: Readonly<{
  sourceStableKey: string;
  mediaStableKey: string;
  directoryUrl: string;
  itunesId?: string;
  feedTitle?: string;
}>): Suggestion {
  const itunesId = input.itunesId?.trim();
  const title = input.feedTitle?.trim();
  if (!itunesId || !/^[1-9]\d{0,19}$/u.test(itunesId) || !title) return null;
  return proposeMediaSeriesSuggestion({
    sourceStableKey: input.sourceStableKey,
    mediaStableKey: input.mediaStableKey,
    kind: "podcast",
    basis: "structured_programme",
    externalSeriesId: `itunes:${itunesId}`,
    title,
    sourceUrl: input.directoryUrl,
    seasonNumber: null,
    episodeNumber: null,
  });
}
