import type { MediaKind } from "./media";
import { isSafeMediaSeriesAuditText } from "./media-series";

export const mediaSeriesSuggestionBases = ["podcast_feed", "structured_programme", "playlist"] as const;
export const mediaSeriesSuggestionWarnings = ["feed_may_be_mixed", "playlist_may_be_curated", "metadata_conflict"] as const;
export type MediaSeriesSuggestionBasis = (typeof mediaSeriesSuggestionBases)[number];
export type MediaSeriesSuggestionWarning = (typeof mediaSeriesSuggestionWarnings)[number];
export type MediaSeriesSuggestionInput = Readonly<{
  sourceStableKey: string; mediaStableKey: string; kind: MediaKind; basis: MediaSeriesSuggestionBasis;
  externalSeriesId: string; title: string; sourceUrl: string;
  seasonNumber: number | null; episodeNumber: number | null; metadataConflict?: boolean;
}>;
export type MediaSeriesSuggestion = Omit<MediaSeriesSuggestionInput, "metadataConflict"> & Readonly<{
  suggestionKey: string; status: "unconfirmed"; warnings: readonly MediaSeriesSuggestionWarning[];
}>;

/** No DNS lookup or fetch: configured acquisition remains the source allowlist gate. */
export function isPublicMediaSeriesSuggestionUrl(value: string): boolean {
  if (!isSafeMediaSeriesAuditText(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (url.protocol !== "https:" || url.username || url.password || !host.includes(".")
      || /^[\d.]+$/u.test(host) || host.includes(":")
      || /(?:^|\.)(?:localhost|local|internal|lan|home)$/u.test(host)) return false;
    const credentialKey = /^(?:auth|authorization|auth_token|access_token|token|api_key|apikey|key|secret|password|jwt|signature|sig|credential|expires|policy|key-pair-id|x-amz-.*|x-goog-.*)$/iu;
    for (const parameters of [url.searchParams, new URLSearchParams(url.hash.slice(1))]) {
      for (const key of parameters.keys()) if (credentialKey.test(key)) return false;
    }
    return true;
  } catch { return false; }
}

/** Titles and inferred episode order are deliberately absent from identity. */
export function mediaSeriesSuggestionIdentity(input: MediaSeriesSuggestionInput): readonly string[] {
  return [input.sourceStableKey, input.mediaStableKey, input.kind, input.basis, input.externalSeriesId];
}

export function warningsForMediaSeriesSuggestion(input: MediaSeriesSuggestionInput): MediaSeriesSuggestionWarning[] {
  const warnings: MediaSeriesSuggestionWarning[] = [];
  if (input.basis === "podcast_feed") warnings.push("feed_may_be_mixed");
  if (input.basis === "playlist") warnings.push("playlist_may_be_curated");
  if (input.metadataConflict) warnings.push("metadata_conflict");
  return warnings;
}
