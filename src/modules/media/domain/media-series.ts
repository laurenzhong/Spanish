import type { MediaKind } from "./media";

export type MediaSeriesOrderMode = "ordered" | "episodic";
export type MediaSeriesStatus = "active" | "archived";
export type MediaSeriesDescriptor = Readonly<{
  seriesKey: string;
  title: string;
  summary: string;
  kind: MediaKind;
  orderMode: MediaSeriesOrderMode;
  status: MediaSeriesStatus;
  revision: number;
}>;
export type MediaSeriesSummary = Readonly<{
  seriesKey: string;
  title: string;
  kind: MediaKind;
  orderMode: MediaSeriesOrderMode;
  revision: number;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeLabel: string | null;
}>;
export type MediaSeriesMembershipInput = Readonly<{
  stableKey: string;
  position: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeLabel: string | null;
  evidence: readonly string[];
}>;
export type SaveMediaSeriesCommand = Readonly<{
  idempotencyKey: string;
  expectedRevision: number;
  title: string;
  summary: string;
  kind: MediaKind;
  orderMode: MediaSeriesOrderMode;
  status: MediaSeriesStatus;
  reason: string;
  evidence: readonly string[];
  members: readonly MediaSeriesMembershipInput[];
  removeStableKeys: readonly string[];
  fromSeriesRevisions: Readonly<Record<string, number>>;
}>;

export type MediaSeriesErrorCode =
  | "MEDIA_SERIES_QUERY_INVALID"
  | "MEDIA_SERIES_COMMAND_INVALID"
  | "MEDIA_SERIES_NOT_AVAILABLE"
  | "MEDIA_SERIES_REVISION_CONFLICT"
  | "MEDIA_SERIES_IDEMPOTENCY_CONFLICT"
  | "MEDIA_SERIES_MEMBERSHIP_CONFLICT"
  | "MEDIA_SERIES_CURSOR_INVALID"
  | "MEDIA_SERIES_UNAVAILABLE";

export class MediaSeriesError extends Error {
  constructor(readonly code: MediaSeriesErrorCode) {
    super(code);
    this.name = "MediaSeriesError";
  }
}

export const mediaSeriesKeyPattern = /^[a-z0-9][a-z0-9._-]{2,199}$/u;
export const mediaSeriesMaximumRevision = 2_147_483_647;

/** Audit fields contain public catalogue metadata and references, never playback credentials. */
export function isSafeMediaSeriesAuditText(value: string): boolean {
  const textIsSafe = !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
    && !/(?:data:audio\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[a-z0-9._~-]+|\bsk-[a-z0-9_-]{12,})/iu.test(value)
    && !/[?&](?:x-amz-[^=\s]*|x-goog-[^=\s]*|signature|sig|token|access_token|api_key|apikey|key-pair-id|policy|expires)\s*=/iu.test(value)
    && !/https?:\/\/[^\s/@]+:[^\s/@]+@/iu.test(value);
  if (!textIsSafe) return false;
  for (const match of value.matchAll(/https?:\/\/[^\s<>]+/giu)) {
    try {
      const url = new URL(match[0]);
      if (url.username || url.password) return false;
      for (const key of url.searchParams.keys()) {
        if (/^(?:x-amz-.*|x-goog-.*|signature|sig|token|access_token|api_key|apikey|key-pair-id|policy|expires)$/iu.test(key)) return false;
      }
    } catch { return false; }
  }
  return true;
}

function validText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max && isSafeMediaSeriesAuditText(value);
}
function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= mediaSeriesMaximumRevision;
}
function nonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= mediaSeriesMaximumRevision;
}
function validEvidence(values: readonly string[]): boolean {
  return Array.isArray(values) && values.length >= 1 && values.length <= 12
    && values.every((value) => validText(value, 1, 500));
}

/** Pure rule gate; application callers must use it even when bypassing HTTP schemas. */
export function validateMediaSeriesCommand(command: SaveMediaSeriesCommand): void {
  const invalid = () => { throw new MediaSeriesError("MEDIA_SERIES_COMMAND_INVALID"); };
  if (!validText(command.idempotencyKey, 8, 120) || !/^[a-zA-Z0-9._:-]+$/u.test(command.idempotencyKey)
    || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 0 || command.expectedRevision > mediaSeriesMaximumRevision
    || !validText(command.title, 1, 200) || !validText(command.summary, 0, 1000)
    || !["video", "podcast"].includes(command.kind) || !["ordered", "episodic"].includes(command.orderMode)
    || !["active", "archived"].includes(command.status) || !validText(command.reason, 1, 1000) || !validEvidence(command.evidence)
    || !Array.isArray(command.members) || command.members.length > 500
    || !Array.isArray(command.removeStableKeys) || command.removeStableKeys.length > 500
    || !command.fromSeriesRevisions || typeof command.fromSeriesRevisions !== "object" || Array.isArray(command.fromSeriesRevisions)
    || Object.keys(command.fromSeriesRevisions).length > 50) invalid();
  const members = new Set<string>();
  const positions = new Set<number>();
  for (const member of command.members) {
    if (!member || typeof member.stableKey !== "string" || !mediaSeriesKeyPattern.test(member.stableKey) || members.has(member.stableKey)
      || (member.position !== null && !positiveInteger(member.position))
      || (member.seasonNumber !== null && !nonnegativeInteger(member.seasonNumber))
      || (member.episodeNumber !== null && !nonnegativeInteger(member.episodeNumber))
      || (member.episodeLabel !== null && !validText(member.episodeLabel, 1, 120)) || !validEvidence(member.evidence)) invalid();
    members.add(member.stableKey);
    if (command.orderMode === "ordered") {
      if (member.position === null || positions.has(member.position)) invalid();
      positions.add(member.position!);
    }
  }
  const removals = new Set<string>();
  for (const stableKey of command.removeStableKeys) {
    if (typeof stableKey !== "string" || !mediaSeriesKeyPattern.test(stableKey) || members.has(stableKey) || removals.has(stableKey)) invalid();
    removals.add(stableKey);
  }
  for (const [seriesKey, revision] of Object.entries(command.fromSeriesRevisions)) {
    if (!mediaSeriesKeyPattern.test(seriesKey) || !positiveInteger(revision)) invalid();
  }
}

/** Repository supplies only current-version, published, cleared, playable visible rows. */
export type MediaSeriesEpisode = Readonly<{
  stableKey: string;
  seriesKey: string;
  kind: MediaKind;
  position: number | null;
  publishedAt: Date | string | null;
}>;
function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function publishedTimestamp(value: MediaSeriesEpisode["publishedAt"]): number {
  if (value === null) return Number.NEGATIVE_INFINITY;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}
export function sortMediaSeriesEpisodes<T extends MediaSeriesEpisode>(orderMode: MediaSeriesOrderMode, episodes: readonly T[]): T[] {
  return [...episodes].sort((left, right) => {
    if (orderMode === "ordered") {
      const leftPosition = left.position ?? Number.POSITIVE_INFINITY;
      const rightPosition = right.position ?? Number.POSITIVE_INFINITY;
      if (leftPosition !== rightPosition) return leftPosition < rightPosition ? -1 : 1;
    } else {
      const leftDate = publishedTimestamp(left.publishedAt);
      const rightDate = publishedTimestamp(right.publishedAt);
      if (leftDate !== rightDate) return leftDate > rightDate ? -1 : 1;
    }
    return compareKeys(left.stableKey, right.stableKey);
  });
}

export function recommendMediaSeriesEpisodes<T extends MediaSeriesEpisode>(input: Readonly<{
  series: Pick<MediaSeriesDescriptor, "seriesKey" | "kind" | "orderMode" | "status">;
  currentStableKey: string;
  episodes: readonly T[];
  limit?: number;
}>): T[] {
  if (input.series.status !== "active" || input.series.kind !== "video") return [];
  const eligible = input.episodes.filter((item) => item.seriesKey === input.series.seriesKey && item.kind === input.series.kind);
  const current = eligible.find((item) => item.stableKey === input.currentStableKey);
  if (!current) return [];
  const seen = new Set<string>([input.currentStableKey]);
  const sorted = sortMediaSeriesEpisodes(input.series.orderMode, eligible).filter((item) => {
    if (seen.has(item.stableKey)) return false;
    seen.add(item.stableKey);
    return true;
  });
  const results = input.series.orderMode === "ordered" && current.position !== null
    ? [...sorted.filter((item) => item.position !== null && item.position > current.position!),
      ...sorted.filter((item) => item.position === null || item.position <= current.position!)]
    : sorted;
  const limit = Number.isFinite(input.limit) ? Math.max(0, Math.min(6, Math.floor(input.limit!))) : 6;
  return results.slice(0, limit);
}
