import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { and, desc, eq, gt, gte, inArray, isNull, lt, lte, max, or, sql } from "drizzle-orm";

import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

import {
  MediaProgressConflictError,
  validateSegmentTimeline,
  MediaUnavailableError,
  matchesMediaTopic,
  nextMediaProgress,
  projectMediaCard,
  projectMediaPlayback,
  type MediaCard,
  type MediaProgress,
  type MediaSeriesSummary,
} from "../domain";
import type { ParsedMediaListQuery } from "../schemas";
import type { MediaLookupResult, MediaRepository } from "./media-repository";
import type { AcquiredPodcastRepository } from "./acquired-podcast-repository";
import type { AcquiredVideoRepository, HostedVideoAsset } from "./acquired-video-repository";
import { createCatalogueCache, type CatalogueCacheEntry } from "./media-catalogue-cache";
import { selectMediaBrowsePage } from "../domain/media-browse";

export class AcquiredVideoPersistenceConflictError extends Error {
  readonly code = "CONTENT_PUBLICATION_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "AcquiredVideoPersistenceConflictError";
  }
}

export class AcquiredPodcastPersistenceConflictError extends Error {
  readonly code = "CONTENT_PUBLICATION_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "AcquiredPodcastPersistenceConflictError";
  }
}

export type DrizzleMediaRepository = MediaRepository & AcquiredVideoRepository & AcquiredPodcastRepository;

type JoinedRow = Readonly<{
  item: typeof schema.mediaItems.$inferSelect;
  version: typeof schema.mediaVersions.$inferSelect;
  asset: typeof schema.mediaAssets.$inferSelect;
}>;

type StoredProgress = Readonly<{
  progress: MediaProgress;
  lastOpenedAt: Date;
}>;

/**
 * The public catalogue rows, cached for ten minutes.
 *
 * The shelf renders this same wide query on every `/learn` visit and on every
 * channel switch, and the rows only change when the daily publishing pipeline
 * runs. Only the catalogue rows are cached - per-user progress is read per
 * request further down, so a resume position is never stale beyond the request
 * that reads it.
 */
const MEDIA_CATALOGUE_CACHE_TTL_MS = 10 * 60 * 1_000;

const runtimeState = globalThis as typeof globalThis & {
  spanishMediaCatalogueCache?: Map<string, CatalogueCacheEntry<unknown>>;
  spanishMediaCatalogueInFlight?: Map<string, Promise<unknown>>;
};

runtimeState.spanishMediaCatalogueCache ??= new Map();
runtimeState.spanishMediaCatalogueInFlight ??= new Map();

function progressRecord(row: typeof schema.userMediaProgress.$inferSelect): MediaProgress {
  return {
    lastPositionMs: row.lastPositionMs,
    lastSegmentIndex: row.lastSegmentIndex,
    status: row.status,
    revision: row.revision,
  };
}

function isPlayable(row: JoinedRow, now: Date): boolean {
  return row.asset.availability === "available"
    && (!row.asset.playbackExpiresAt || row.asset.playbackExpiresAt.getTime() > now.getTime());
}

function browseSourceIdentity(row: JoinedRow): string {
  if (row.item.kind === "video") {
    const channelId = row.version.sourceChannelId?.trim();
    if (channelId && /^UC[A-Za-z0-9_-]{22}$/u.test(channelId)) return `youtube-channel:${channelId}`;
  } else if (row.version.sourceFeedUrl) {
    try {
      const feed = new URL(row.version.sourceFeedUrl);
      if (feed.protocol !== "https:" || feed.username || feed.password) return `media:${row.item.stableKey}`;
      // Inventory review MEDIA-SERIES-002 established that this registered
      // Language Reactor URL is a mixed acquisition catalogue, never a show RSS.
      if (["https://www.languagereactor.com", "https://languagereactor.com"].includes(feed.origin)
        && /^\/c\/es\/pd\/t_pd_mix_es\/?$/u.test(feed.pathname)) return "registered-source:language-reactor:es-podcast-mix";
      for (const key of feed.searchParams.keys()) {
        if (/^(?:x-amz-.*|x-goog-.*|signature|sig|token|access_token|api_key|apikey|key-pair-id|policy|expires)$/iu.test(key)) return `media:${row.item.stableKey}`;
      }
      feed.hash = "";
      feed.searchParams.sort();
      // Hash even public feed metadata so source identifiers cannot accidentally
      // expose feed query parameters when inspected by internal diagnostics.
      return `podcast-feed:${createHash("sha256").update(feed.toString()).digest("hex")}`;
    } catch { /* Unverified feed metadata stays an independent media source. */ }
  }
  return `media:${row.item.stableKey}`;
}

function assertHostedVideoAsset(asset: HostedVideoAsset): void {
  if (asset.providerKey !== "bunny-storage" || asset.mimeType !== "video/mp4" || !/^[a-f0-9]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.byteSize) || asset.byteSize <= 0) {
    throw new AcquiredVideoPersistenceConflictError("The video must be a validated Bunny MP4 asset.");
  }
  let url: URL;
  try { url = new URL(asset.playbackUrl); } catch { throw new AcquiredVideoPersistenceConflictError("The Bunny video URL is invalid."); }
  const configuredHost = process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME?.trim().toLowerCase();
  const allowedHost = configuredHost ? url.hostname.toLowerCase() === configuredHost : url.hostname.toLowerCase().endsWith(".b-cdn.net");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.startsWith("/media/") || !allowedHost) {
    throw new AcquiredVideoPersistenceConflictError("The video must use a stable Bunny Storage Pull Zone MP4 URL.");
  }
}

function projectCard(row: JoinedRow, progress: MediaProgress | null, now: Date, series: MediaSeriesSummary | null = null): MediaCard | null {
  const card = projectMediaCard({
    stableKey: row.item.stableKey,
    version: row.version.version,
    kind: row.item.kind,
    title: row.version.title,
    summary: row.version.summary,
    sourceName: row.version.sourceName,
    language: row.version.language,
    region: row.version.region,
    cefr: row.version.cefr as "A1" | "A2" | "B1" | "B2" | null,
    topics: row.version.topics,
    durationMs: row.version.durationMs,
    publishedAt: row.version.publicationDate,
    curatedAt: row.version.curatedAt,
    contentHash: row.version.contentHash,
    status: row.version.status,
    copyrightStatus: row.version.copyrightStatus as "unverified" | "cleared" | "restricted",
    playable: isPlayable(row, now),
    artwork: row.version.artworkUrl && row.version.artworkAlt && row.version.artworkSource
      ? {
          url: row.version.artworkUrl,
          alt: row.version.artworkAlt,
          source: row.version.artworkSource,
          width: row.version.artworkWidth,
          height: row.version.artworkHeight,
          expiresAt: row.version.artworkExpiresAt,
        }
      : null,
    progress,
  }, now);
  return card ? { ...card, series } : null;
}

type MediaCursor = Readonly<{ id: string; curatedAt?: string; stableKey?: string }>;

function encodeCursor(item: MediaCard): string {
  return Buffer.from(JSON.stringify({ id: item.id, curatedAt: item.curatedAt, stableKey: item.stableKey }), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): MediaCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { id?: unknown; curatedAt?: unknown; stableKey?: unknown };
    if (typeof parsed.id !== "string") throw new Error();
    return {
      id: parsed.id,
      curatedAt: typeof parsed.curatedAt === "string" ? parsed.curatedAt : undefined,
      stableKey: typeof parsed.stableKey === "string" ? parsed.stableKey : undefined,
    };
  } catch {
    throw new Error("MEDIA_CURSOR_INVALID");
  }
}

function matches(item: MediaCard, query: ParsedMediaListQuery): boolean {
  if (query.kind && item.kind !== query.kind) return false;
  if (query.topic && !matchesMediaTopic(item.topics, query.topic)) return false;
  if (query.cefr && item.cefr !== query.cefr) return false;
  if (query.region === "unknown" && item.region !== null) return false;
  if (query.region && query.region !== "unknown") {
    const excluded = query.region === "latin-amer"
      ? item.region === "es-ES" || item.region === null
      : item.region !== query.region;
    if (excluded) return false;
  }
  if (query.duration === "short" && item.durationMs >= 5 * 60_000) return false;
  if (query.duration === "medium" && (item.durationMs < 5 * 60_000 || item.durationMs > 20 * 60_000)) return false;
  if (query.duration === "long" && item.durationMs <= 20 * 60_000) return false;
  if (query.search) {
    const needle = query.search.normalize("NFKD").toLocaleLowerCase("es");
    const haystack = [item.title, item.summary, item.sourceName, ...item.topics]
      .join(" ").normalize("NFKD").toLocaleLowerCase("es");
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export function createDrizzleMediaRepository(
  database: Database,
  dependencies: Readonly<{ now?: () => Date }> = {},
): DrizzleMediaRepository {
  const now = dependencies.now ?? (() => new Date());
  const catalogueCache = createCatalogueCache({
    ttlMs: MEDIA_CATALOGUE_CACHE_TTL_MS,
    entries: runtimeState.spanishMediaCatalogueCache,
    inFlight: runtimeState.spanishMediaCatalogueInFlight,
  });

  async function joinedRows(stableKey?: string, query?: ParsedMediaListQuery, fullCatalogue = false): Promise<JoinedRow[]> {
    const published = and(
      eq(schema.mediaVersions.status, "published"),
      eq(schema.mediaVersions.copyrightStatus, "cleared"),
      eq(schema.mediaAssets.availability, "available"),
      or(
        eq(schema.mediaItems.kind, "podcast"),
        and(eq(schema.mediaItems.kind, "video"), eq(schema.mediaAssets.kind, "video"), eq(schema.mediaAssets.providerKey, "bunny-storage")),
      ),
    );
    const filters = [published];
    if (stableKey) filters.push(eq(schema.mediaItems.stableKey, stableKey));
    if (query?.kind) filters.push(eq(schema.mediaItems.kind, query.kind));
    if (query?.cefr) filters.push(eq(schema.mediaVersions.cefr, query.cefr));
    if (query?.region === "unknown") filters.push(isNull(schema.mediaVersions.region));
    if (query?.region && query.region !== "unknown" && query.region !== "latin-amer") {
      filters.push(eq(schema.mediaVersions.region, query.region));
    }
    if (query?.duration === "short") filters.push(lte(schema.mediaVersions.durationMs, 5 * 60_000 - 1));
    if (query?.duration === "medium") filters.push(and(gte(schema.mediaVersions.durationMs, 5 * 60_000), lte(schema.mediaVersions.durationMs, 20 * 60_000)));
    if (query?.duration === "long") filters.push(gt(schema.mediaVersions.durationMs, 20 * 60_000));
    const cursor = query?.cursor ? decodeCursor(query.cursor) : null;
    const canUseDatabaseCursor = Boolean(cursor?.curatedAt && cursor.stableKey && !query?.search && !query?.topic && query?.sort === "recently_added");
    if (canUseDatabaseCursor && cursor?.curatedAt && cursor.stableKey) {
      const curatedAt = new Date(cursor.curatedAt);
      if (Number.isNaN(curatedAt.getTime())) throw new Error("MEDIA_CURSOR_INVALID");
      filters.push(or(
        lt(schema.mediaVersions.curatedAt, curatedAt),
        and(eq(schema.mediaVersions.curatedAt, curatedAt), gt(schema.mediaItems.stableKey, cursor.stableKey)),
      ));
    }
    const canLimitToPage = Boolean(query && query.sort === "recently_added" && !query.search && !query.topic && (!query.cursor || canUseDatabaseCursor));
    const statement = database
      .select({ item: schema.mediaItems, version: schema.mediaVersions, asset: schema.mediaAssets })
      .from(schema.mediaItems)
      .innerJoin(
        schema.mediaVersions,
        and(
          eq(schema.mediaVersions.mediaItemId, schema.mediaItems.id),
          eq(schema.mediaVersions.version, schema.mediaItems.currentVersion),
        ),
      )
      .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.mediaVersionId, schema.mediaVersions.id))
      .where(and(...filters))
      .orderBy(desc(schema.mediaVersions.curatedAt), schema.mediaItems.stableKey);
    return fullCatalogue ? statement : statement.limit(canLimitToPage ? (query?.pageSize ?? 18) + 1 : 500);
  }

  async function progressByVersion(userId: string | undefined, versionIds: readonly string[]) {
    const result = new Map<string, StoredProgress>();
    if (!userId || versionIds.length === 0) return result;
    const rows = await database
      .select()
      .from(schema.userMediaProgress)
      .where(and(
        eq(schema.userMediaProgress.userId, userId),
        inArray(schema.userMediaProgress.mediaVersionId, [...versionIds]),
      ));
    for (const row of rows) {
      result.set(row.mediaVersionId, { progress: progressRecord(row), lastOpenedAt: row.lastOpenedAt });
    }
    return result;
  }

  // Directory metadata has its own revision and can change without publishing a
  // new media version. Keep this one batched read outside the catalogue cache.
  async function summariesByItemIds(itemIds: readonly string[]) {
    const result = new Map<string, MediaSeriesSummary>();
    if (!itemIds.length) return result;
    const rows = await database.select({
      mediaItemId: schema.mediaSeriesMemberships.mediaItemId,
      seriesKey: schema.mediaSeries.seriesKey,
      title: schema.mediaSeries.title,
      kind: schema.mediaSeries.kind,
      orderMode: schema.mediaSeries.orderMode,
      revision: schema.mediaSeries.revision,
      seasonNumber: schema.mediaSeriesMemberships.seasonNumber,
      episodeNumber: schema.mediaSeriesMemberships.episodeNumber,
      episodeLabel: schema.mediaSeriesMemberships.episodeLabel,
    }).from(schema.mediaSeriesMemberships)
      .innerJoin(schema.mediaSeries, eq(schema.mediaSeries.id, schema.mediaSeriesMemberships.seriesId))
      .where(and(inArray(schema.mediaSeriesMemberships.mediaItemId, [...new Set(itemIds)]), eq(schema.mediaSeries.status, "active")));
    for (const { mediaItemId, ...summary } of rows) result.set(mediaItemId, summary);
    return result;
  }

  async function lookup(stableKey: string, userId?: string): Promise<MediaLookupResult> {
    const rows = await joinedRows(stableKey);
    if (rows.length === 0) return { reason: "not_found", media: null };
    const selected = rows.find((row) => isPlayable(row, now()));
    if (!selected) return { reason: "unavailable", media: null };
    const [progress, summaries] = await Promise.all([
      progressByVersion(userId, [selected.version.id]),
      summariesByItemIds([selected.item.id]),
    ]);
    const media = projectCard(selected, progress.get(selected.version.id)?.progress ?? null, now(), summaries.get(selected.item.id) ?? null);
    return media ? { reason: "found", media } : { reason: "unavailable", media: null };
  }

  return {
    async publishAcquiredPodcast(input) {
      if (input.contentHash !== input.draft.contentHash) {
        throw new AcquiredPodcastPersistenceConflictError("The candidate hash does not match the immutable podcast draft.");
      }
      let feedUrl: URL;
      let enclosureUrl: URL;
      try {
        feedUrl = new URL(input.draft.feedUrl);
        enclosureUrl = new URL(input.draft.enclosureUrl);
      } catch {
        throw new AcquiredPodcastPersistenceConflictError("The podcast feed or enclosure URL is invalid.");
      }
      const playbackExpiresAt = input.draft.playbackExpiresAt ? new Date(input.draft.playbackExpiresAt) : null;
      if (
        feedUrl.protocol !== "https:"
        || enclosureUrl.protocol !== "https:"
        || feedUrl.username
        || feedUrl.password
        || enclosureUrl.username
        || enclosureUrl.password
        || (playbackExpiresAt !== null && (Number.isNaN(playbackExpiresAt.getTime())
          || playbackExpiresAt.getTime() <= input.publishedAt.getTime()))
      ) {
        throw new AcquiredPodcastPersistenceConflictError("The podcast playback asset is not safely usable at publication time.");
      }
      const transcriptMatches = input.draft.transcriptStatus === "unavailable"
        ? input.draft.transcriptUrl === null && input.draft.segments.length === 0
        : input.draft.segments.length > 0
          && input.draft.segments.every((segment) => segment.sourceKind === input.draft.transcriptStatus)
          && (input.draft.transcriptStatus === "asr" ? input.draft.transcriptUrl === null : input.draft.transcriptUrl !== null);
      if (!transcriptMatches) {
        throw new AcquiredPodcastPersistenceConflictError("The podcast transcript state does not match its reviewed timeline.");
      }
      if (input.draft.segments.length > 0) validateSegmentTimeline(input.draft.segments, input.draft.durationMs);

      return database.transaction(async (transaction) => {
        const [existing] = await transaction
          .select({ item: schema.mediaItems, version: schema.mediaVersions })
          .from(schema.mediaVersions)
          .innerJoin(schema.mediaItems, eq(schema.mediaItems.id, schema.mediaVersions.mediaItemId))
          .where(and(
            eq(schema.mediaVersions.acquisitionCandidateId, input.candidateId),
            eq(schema.mediaVersions.acquisitionCandidateRevision, input.candidateRevision),
          ))
          .limit(1);
        if (existing) {
          if (
            existing.item.kind !== "podcast"
            || existing.item.stableKey !== input.draft.stableKey
            || existing.version.contentHash !== input.contentHash
            || existing.version.sourceUrl !== input.draft.canonicalUrl
            || existing.version.enclosureUrlHash !== input.draft.enclosureUrlHash
          ) {
            throw new AcquiredPodcastPersistenceConflictError("The candidate revision already published different immutable media.");
          }
          return { kind: "media" as const, stableKey: existing.item.stableKey, version: existing.version.version };
        }

        await transaction.insert(schema.mediaItems).values({
          stableKey: input.draft.stableKey,
          kind: "podcast",
        }).onConflictDoNothing({ target: schema.mediaItems.stableKey });
        const [item] = await transaction.select().from(schema.mediaItems)
          .where(eq(schema.mediaItems.stableKey, input.draft.stableKey)).limit(1).for("update");
        if (!item || item.kind !== "podcast") {
          throw new AcquiredPodcastPersistenceConflictError("The media identity could not be claimed as a podcast.");
        }
        const [latest] = await transaction.select({ value: max(schema.mediaVersions.version) })
          .from(schema.mediaVersions).where(eq(schema.mediaVersions.mediaItemId, item.id));
        const versionNumber = Number(latest?.value ?? 0) + 1;
        const [version] = await transaction.insert(schema.mediaVersions).values({
          mediaItemId: item.id,
          version: versionNumber,
          locale: "es-ES",
          title: input.draft.title,
          summary: input.draft.summary,
          sourceName: input.draft.sourceName,
          sourceUrl: input.draft.canonicalUrl,
          platformSourceId: input.draft.episodeGuid,
          sourceFeedUrl: input.draft.feedUrl,
          enclosureUrlHash: input.draft.enclosureUrlHash,
          artworkUrl: (input.artworkOverride ?? input.draft.artwork)?.url ?? null,
          artworkAlt: (input.artworkOverride ?? input.draft.artwork)?.alt ?? null,
          artworkSource: (input.artworkOverride ?? input.draft.artwork)?.source ?? null,
          artworkWidth: (input.artworkOverride ?? input.draft.artwork)?.width ?? null,
          artworkHeight: (input.artworkOverride ?? input.draft.artwork)?.height ?? null,
          artworkExpiresAt: (input.artworkOverride ?? input.draft.artwork)?.expiresAt ? new Date((input.artworkOverride ?? input.draft.artwork)!.expiresAt!) : null,
          language: input.draft.language,
          region: input.draft.region,
          cefr: input.draft.cefr,
          topics: [...input.draft.topics],
          durationMs: input.draft.durationMs,
          publicationDate: new Date(input.draft.publicationDate),
          curatedAt: input.publishedAt,
          publishedAt: input.publishedAt,
          contentHash: input.contentHash,
          status: "published",
          license: input.draft.license,
          attribution: input.draft.attribution,
          licenseEvidence: input.draft.licenseEvidence,
          copyrightStatus: input.draft.copyrightStatus,
          acquisitionCandidateId: input.candidateId,
          acquisitionCandidateRevision: input.candidateRevision,
          fetchedAt: new Date(input.draft.fetchedAt),
          changeReason: input.draft.changeReason,
          reviewNotes: "Published from a versioned podcast RSS candidate after independent es-ES and zh-CN review.",
        }).returning({ id: schema.mediaVersions.id });
        if (!version) throw new Error("MEDIA_VERSION_WRITE_FAILED");
        await transaction.insert(schema.mediaAssets).values({
          mediaVersionId: version.id,
          kind: "audio",
          providerKey: input.draft.playbackProvider,
          playbackUrl: input.draft.enclosureUrl,
          playbackExpiresAt,
          mimeType: input.draft.enclosureMimeType,
          availability: "available",
        });
        if (input.draft.segments.length > 0) {
          await transaction.insert(schema.mediaSegments).values(input.draft.segments.map((segment) => ({
            mediaVersionId: version.id,
            segmentIndex: segment.index,
            startMs: segment.startMs,
            endMs: segment.endMs,
            speaker: segment.speaker,
            sourceText: segment.sourceText,
            words: segment.words ?? null,
            translation: segment.translation,
            confidence: segment.confidence,
            sourceKind: segment.sourceKind,
            reviewStatus: "approved" as const,
          })));
        }
        await transaction.insert(schema.contentReviews).values(input.reviews.map((review) => ({
          entityType: "media",
          entityId: version.id,
          locale: review.locale,
          status: "approved" as const,
          reviewerReference: review.reviewerReference,
          notes: review.notes,
          reviewedAt: review.reviewedAt,
        })));
        await transaction.update(schema.mediaItems).set({ currentVersion: versionNumber, updatedAt: input.publishedAt })
          .where(eq(schema.mediaItems.id, item.id));
        return { kind: "media" as const, stableKey: item.stableKey, version: versionNumber };
      });
    },

    async archiveAcquiredPodcast(input) {
      await database.transaction(async (transaction) => {
        const [row] = await transaction
          .select({
            itemId: schema.mediaItems.id,
            itemKind: schema.mediaItems.kind,
            currentVersion: schema.mediaItems.currentVersion,
            versionId: schema.mediaVersions.id,
            version: schema.mediaVersions.version,
            status: schema.mediaVersions.status,
          })
          .from(schema.mediaVersions)
          .innerJoin(schema.mediaItems, eq(schema.mediaItems.id, schema.mediaVersions.mediaItemId))
          .where(and(
            eq(schema.mediaItems.stableKey, input.publication.stableKey),
            eq(schema.mediaVersions.version, input.publication.version),
            eq(schema.mediaVersions.acquisitionCandidateId, input.candidateId),
          ))
          .limit(1)
          .for("update");
        if (!row || row.itemKind !== "podcast") {
          throw new AcquiredPodcastPersistenceConflictError("The podcast publication does not belong to this candidate.");
        }
        if (row.status === "archived") return;
        if (row.status !== "published") throw new AcquiredPodcastPersistenceConflictError("Only published media can be archived.");
        const updated = await transaction.update(schema.mediaVersions).set({ status: "archived", updatedAt: input.archivedAt })
          .where(and(eq(schema.mediaVersions.id, row.versionId), eq(schema.mediaVersions.status, "published")))
          .returning({ id: schema.mediaVersions.id });
        if (updated.length !== 1) throw new AcquiredPodcastPersistenceConflictError("The media changed before archival.");
        await transaction.update(schema.mediaAssets).set({ availability: "withdrawn", updatedAt: input.archivedAt })
          .where(eq(schema.mediaAssets.mediaVersionId, row.versionId));
        if (row.currentVersion === row.version) {
          await transaction.update(schema.mediaItems).set({ currentVersion: null, updatedAt: input.archivedAt })
            .where(eq(schema.mediaItems.id, row.itemId));
        }
      });
    },

    async publishAcquiredVideo(input) {
      if (input.contentHash !== input.draft.contentHash) {
        throw new AcquiredVideoPersistenceConflictError("The candidate hash does not match the immutable video draft.");
      }
      assertHostedVideoAsset(input.hostedAsset);
      let embedUrl: URL;
      try {
        embedUrl = new URL(input.draft.embedUrl);
      } catch {
        throw new AcquiredVideoPersistenceConflictError("The official embed URL is invalid.");
      }
      if (
        embedUrl.origin !== "https://www.youtube-nocookie.com"
        || embedUrl.username !== ""
        || embedUrl.password !== ""
        || embedUrl.pathname !== `/embed/${input.draft.platformVideoId}`
      ) {
        throw new AcquiredVideoPersistenceConflictError("The video must use the official privacy-enhanced YouTube embed.");
      }
      if (input.draft.segments.length > 0) {
        validateSegmentTimeline(input.draft.segments, input.draft.durationMs);
      } else if (input.draft.captionStatus !== "unavailable") {
        throw new AcquiredVideoPersistenceConflictError("A captioned video must include a reviewed timeline.");
      }

      return database.transaction(async (transaction) => {
        const [existing] = await transaction
          .select({ item: schema.mediaItems, version: schema.mediaVersions })
          .from(schema.mediaVersions)
          .innerJoin(schema.mediaItems, eq(schema.mediaItems.id, schema.mediaVersions.mediaItemId))
          .where(and(
            eq(schema.mediaVersions.acquisitionCandidateId, input.candidateId),
            eq(schema.mediaVersions.acquisitionCandidateRevision, input.candidateRevision),
          ))
          .limit(1);
        if (existing) {
          if (
            existing.item.stableKey !== input.draft.stableKey
            || existing.version.contentHash !== input.contentHash
            || existing.version.sourceUrl !== input.draft.canonicalUrl
          ) {
            throw new AcquiredVideoPersistenceConflictError("The candidate revision already published different immutable media.");
          }
          return { kind: "media" as const, stableKey: existing.item.stableKey, version: existing.version.version };
        }

        await transaction.insert(schema.mediaItems).values({
          stableKey: input.draft.stableKey,
          kind: "video",
        }).onConflictDoNothing({ target: schema.mediaItems.stableKey });
        const [item] = await transaction.select().from(schema.mediaItems)
          .where(eq(schema.mediaItems.stableKey, input.draft.stableKey)).limit(1).for("update");
        if (!item || item.kind !== "video") {
          throw new AcquiredVideoPersistenceConflictError("The media identity could not be claimed as a video.");
        }
        const [latest] = await transaction.select({ value: max(schema.mediaVersions.version) })
          .from(schema.mediaVersions).where(eq(schema.mediaVersions.mediaItemId, item.id));
        const versionNumber = Number(latest?.value ?? 0) + 1;
        const [version] = await transaction.insert(schema.mediaVersions).values({
          mediaItemId: item.id,
          version: versionNumber,
          locale: "es-ES",
          title: input.draft.title,
          summary: input.draft.summary,
          sourceName: input.draft.sourceName,
          sourceUrl: input.draft.canonicalUrl,
          platformSourceId: input.draft.platformVideoId,
          sourceChannelId: input.draft.sourceChannelId,
          artworkUrl: (input.artworkOverride ?? input.draft.artwork)?.url ?? null,
          artworkAlt: (input.artworkOverride ?? input.draft.artwork)?.alt ?? null,
          artworkSource: (input.artworkOverride ?? input.draft.artwork)?.source ?? null,
          artworkWidth: (input.artworkOverride ?? input.draft.artwork)?.width ?? null,
          artworkHeight: (input.artworkOverride ?? input.draft.artwork)?.height ?? null,
          artworkExpiresAt: (input.artworkOverride ?? input.draft.artwork)?.expiresAt ? new Date((input.artworkOverride ?? input.draft.artwork)!.expiresAt!) : null,
          language: input.draft.language,
          region: input.draft.region,
          cefr: input.draft.cefr,
          topics: [...input.draft.topics],
          durationMs: input.draft.durationMs,
          publicationDate: new Date(input.draft.publicationDate),
          curatedAt: input.publishedAt,
          publishedAt: input.publishedAt,
          contentHash: input.contentHash,
          status: "published",
          license: input.draft.license,
          attribution: input.draft.attribution,
          licenseEvidence: input.draft.licenseEvidence,
          copyrightStatus: input.draft.copyrightStatus,
          acquisitionCandidateId: input.candidateId,
          acquisitionCandidateRevision: input.candidateRevision,
          fetchedAt: new Date(input.draft.fetchedAt),
          changeReason: input.draft.changeReason,
          reviewNotes: "Published from a versioned YouTube candidate after independent es-ES and zh-CN review.",
        }).returning({ id: schema.mediaVersions.id });
        if (!version) throw new Error("MEDIA_VERSION_WRITE_FAILED");
        await transaction.insert(schema.mediaAssets).values({
          mediaVersionId: version.id,
          kind: "video",
          providerKey: input.hostedAsset.providerKey,
          playbackUrl: input.hostedAsset.playbackUrl,
          playbackExpiresAt: null,
          mimeType: input.hostedAsset.mimeType,
          availability: "available",
        });
        if (input.draft.segments.length > 0) {
          await transaction.insert(schema.mediaSegments).values(input.draft.segments.map((segment) => ({
            mediaVersionId: version.id,
            segmentIndex: segment.index,
            startMs: segment.startMs,
            endMs: segment.endMs,
            speaker: segment.speaker,
            sourceText: segment.sourceText,
            words: segment.words ?? null,
            translation: segment.translation,
            confidence: segment.confidence,
            sourceKind: segment.sourceKind,
            reviewStatus: "approved" as const,
          })));
        }
        await transaction.insert(schema.contentReviews).values(input.reviews.map((review) => ({
          entityType: "media",
          entityId: version.id,
          locale: review.locale,
          status: "approved" as const,
          reviewerReference: review.reviewerReference,
          notes: review.notes,
          reviewedAt: review.reviewedAt,
        })));
        await transaction.update(schema.mediaItems).set({
          currentVersion: versionNumber,
          updatedAt: input.publishedAt,
        }).where(eq(schema.mediaItems.id, item.id));
        return { kind: "media" as const, stableKey: item.stableKey, version: versionNumber };
      });
    },

    async archiveAcquiredVideo(input) {
      await database.transaction(async (transaction) => {
        const [row] = await transaction
          .select({
            itemId: schema.mediaItems.id,
            currentVersion: schema.mediaItems.currentVersion,
            versionId: schema.mediaVersions.id,
            version: schema.mediaVersions.version,
            status: schema.mediaVersions.status,
          })
          .from(schema.mediaVersions)
          .innerJoin(schema.mediaItems, eq(schema.mediaItems.id, schema.mediaVersions.mediaItemId))
          .where(and(
            eq(schema.mediaItems.stableKey, input.publication.stableKey),
            eq(schema.mediaVersions.version, input.publication.version),
            eq(schema.mediaVersions.acquisitionCandidateId, input.candidateId),
          ))
          .limit(1)
          .for("update");
        if (!row) throw new AcquiredVideoPersistenceConflictError("The media publication does not belong to this candidate.");
        if (row.status === "archived") return;
        if (row.status !== "published") throw new AcquiredVideoPersistenceConflictError("Only published media can be archived.");
        const updated = await transaction.update(schema.mediaVersions).set({ status: "archived", updatedAt: input.archivedAt })
          .where(and(eq(schema.mediaVersions.id, row.versionId), eq(schema.mediaVersions.status, "published")))
          .returning({ id: schema.mediaVersions.id });
        if (updated.length !== 1) throw new AcquiredVideoPersistenceConflictError("The media changed before archival.");
        await transaction.update(schema.mediaAssets).set({ availability: "withdrawn", updatedAt: input.archivedAt })
          .where(eq(schema.mediaAssets.mediaVersionId, row.versionId));
        if (row.currentVersion === row.version) {
          await transaction.update(schema.mediaItems).set({ currentVersion: null, updatedAt: input.archivedAt })
            .where(eq(schema.mediaItems.id, row.itemId));
        }
      });
    },

    async browse(query, userId) {
      const filters: ParsedMediaListQuery = { ...query.filters, sort: "newest", pageSize: query.pageSize };
      // Explicit browsing revalidates publication/rights/assets, bypassing the
      // ten-minute shelf cache. Never fall back to stale rows on failure.
      const rows = await joinedRows(undefined, filters, true);
      const selected = new Map<string, JoinedRow>();
      for (const row of rows) {
        if (!selected.has(row.item.stableKey) && isPlayable(row, now())) selected.set(row.item.stableKey, row);
      }
      const summaries = await summariesByItemIds([...selected.values()].map((row) => row.item.id));
      const cards = [...selected.values()].flatMap((row) => {
        const card = projectCard(row, null, now(), summaries.get(row.item.id) ?? null);
        return card && matches(card, filters) ? [card] : [];
      });
      const sourceIdentities = new Map([...selected.values()].map((row) => [row.item.stableKey, browseSourceIdentity(row)]));
      const page = selectMediaBrowsePage(cards, query, sourceIdentities);
      const pageRows = page.items.map((card) => selected.get(card.stableKey)!);
      const progress = await progressByVersion(userId, pageRows.map((row) => row.version.id));
      return { ...page, items: page.items.map((card) => ({ ...card, progress: progress.get(selected.get(card.stableKey)!.version.id)?.progress ?? null })) };
    },

    async list(query, userId) {
      // The catalogue rows are public and cached; the per-user progress below is
      // always read fresh, so only the shelf's resume label depends on this read.
      const rows = await catalogueCache.load(`list:${JSON.stringify(query)}`, () => joinedRows(undefined, query));
      const selected = new Map<string, JoinedRow>();
      for (const row of rows) {
        if (!selected.has(row.item.stableKey) && isPlayable(row, now())) selected.set(row.item.stableKey, row);
      }
      const [progress, summaries] = await Promise.all([
        progressByVersion(userId, [...selected.values()].map((row) => row.version.id)),
        summariesByItemIds([...selected.values()].map((row) => row.item.id)),
      ]);
      const itemsWithActivity = [...selected.values()].flatMap((row) => {
        const stored = progress.get(row.version.id);
        const item = projectCard(row, stored?.progress ?? null, now(), summaries.get(row.item.id) ?? null);
        return item && matches(item, query) ? [{ item, lastOpenedAt: stored?.lastOpenedAt ?? null }] : [];
      });
      if (query.sort === "newest") {
        itemsWithActivity.sort((left, right) => (right.item.publishedAt ?? "").localeCompare(left.item.publishedAt ?? ""));
      }
      if (query.sort === "recently_played") {
        itemsWithActivity.sort((left, right) => (right.lastOpenedAt?.getTime() ?? 0) - (left.lastOpenedAt?.getTime() ?? 0));
      }
      let items = itemsWithActivity.map(({ item }) => item);
      const cursor = decodeCursor(query.cursor);
      if (cursor) {
        if (!cursor.curatedAt || !cursor.stableKey) {
          const index = items.findIndex((item) => item.id === cursor.id);
          if (index < 0) throw new Error("MEDIA_CURSOR_INVALID");
          items = items.slice(index + 1);
        }
      }
      const hasMore = items.length > query.pageSize;
      const page = items.slice(0, query.pageSize);
      return {
        items: page,
        hasMore,
        nextCursor: hasMore && page.length > 0 ? encodeCursor(page.at(-1)!) : null,
      };
    },

    findByStableKey: lookup,

    async getSegmentLookup(stableKey, lookFor, requestedAt) {
      const rows = await joinedRows(stableKey);
      const selected = rows.find((row) => isPlayable(row, requestedAt));
      if (!selected) return null;
      // Only the columns a clip needs — but `words` is one of them: the clip window is
      // the word's own timing inside the segment, so a read that omitted the timeline
      // could only ever fall back to the whole segment. What is dropped is the *rest* of
      // the transcript (translation, speaker) and every other segment.
      const columns = {
        id: schema.mediaSegments.id,
        index: schema.mediaSegments.segmentIndex,
        startMs: schema.mediaSegments.startMs,
        endMs: schema.mediaSegments.endMs,
        sourceText: schema.mediaSegments.sourceText,
        words: schema.mediaSegments.words,
      };
      const byIndex = lookFor.segmentIndex === null
        ? []
        : await database
          .select(columns)
          .from(schema.mediaSegments)
          .where(and(
            eq(schema.mediaSegments.mediaVersionId, selected.version.id),
            eq(schema.mediaSegments.segmentIndex, lookFor.segmentIndex),
            eq(schema.mediaSegments.sourceText, lookFor.expectedText),
          ))
          .limit(1);
      const candidates = byIndex.length
        ? byIndex
        : await database
          .select(columns)
          .from(schema.mediaSegments)
          .where(and(
            eq(schema.mediaSegments.mediaVersionId, selected.version.id),
            eq(schema.mediaSegments.sourceText, lookFor.expectedText),
          ))
          .limit(2);
      return {
        stableKey: selected.item.stableKey,
        title: selected.version.title,
        version: selected.version.version,
        asset: {
          kind: selected.asset.kind,
          url: selected.asset.playbackUrl,
          expiresAt: selected.asset.playbackExpiresAt,
        },
        candidates,
      };
    },

    async getStreamSource(stableKey, requestedAt) {
      // Range requests must recheck publication/rights/availability, but do not
      // need to download the full transcript or read personal progress again.
      const rows = await joinedRows(stableKey);
      const selected = rows.find((row) => isPlayable(row, requestedAt));
      if (!selected) throw new MediaUnavailableError();
      const card = projectCard(selected, null, requestedAt);
      if (!card) throw new MediaUnavailableError();
      const { asset } = projectMediaPlayback({
        card,
        asset: { kind: selected.asset.kind, url: selected.asset.playbackUrl, expiresAt: selected.asset.playbackExpiresAt },
        segments: [],
      }, requestedAt);
      return {
        media: { stableKey: card.stableKey, version: card.version, kind: card.kind, title: card.title, sourceName: card.sourceName },
        asset,
      };
    },

    async getPlaybackOverview(stableKey, userId, requestedAt) {
      // The detail page needs the same gates as getPlayback — current version,
      // published, cleared rights, playable asset, unexpired URL — but not the
      // transcript. Reading one aggregate row instead of every segment (and every
      // segment's word JSON) is what lets the title and player stream first.
      const rows = await joinedRows(stableKey);
      const selected = rows.find((row) => isPlayable(row, requestedAt));
      if (!selected) throw new MediaUnavailableError();
      const [progress, summaries, segmentCountRows] = await Promise.all([
        progressByVersion(userId, [selected.version.id]),
        summariesByItemIds([selected.item.id]),
        database
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.mediaSegments)
          .where(and(
            eq(schema.mediaSegments.mediaVersionId, selected.version.id),
            eq(schema.mediaSegments.reviewStatus, "approved"),
          )),
      ]);
      const media = projectCard(selected, progress.get(selected.version.id)?.progress ?? null, requestedAt, summaries.get(selected.item.id) ?? null);
      if (!media) throw new MediaUnavailableError();
      const { asset } = projectMediaPlayback({
        card: media,
        asset: {
          kind: selected.asset.kind,
          url: selected.asset.playbackUrl,
          expiresAt: selected.asset.playbackExpiresAt,
        },
        segments: [],
      }, requestedAt);
      const segmentCount = segmentCountRows[0]?.count ?? 0;
      if (!Number.isSafeInteger(segmentCount) || segmentCount < 0) throw new MediaUnavailableError();
      return { media, asset, segmentCount };
    },

    async getPlayback(stableKey, userId, requestedAt, options = {}) {
      const includeWords = options.includeWords ?? true;
      const rows = await joinedRows(stableKey);
      const selected = rows.find((row) => isPlayable(row, requestedAt));
      if (!selected) throw new MediaUnavailableError();
      // Both reads depend only on the selected version, so the transcript no
      // longer queues behind the progress lookup: one remote round trip saved on
      // every media item open.
      const [progress, segments, summaries] = await Promise.all([
        progressByVersion(userId, [selected.version.id]),
        database
          .select({
            id: schema.mediaSegments.id,
            segmentIndex: schema.mediaSegments.segmentIndex,
            startMs: schema.mediaSegments.startMs,
            endMs: schema.mediaSegments.endMs,
            sourceText: schema.mediaSegments.sourceText,
            translation: schema.mediaSegments.translation,
            speaker: schema.mediaSegments.speaker,
            // The text-only phase never transfers the word-timing JSON; a SQL
            // NULL keeps the row shape identical, so only bytes are saved.
            words: includeWords ? schema.mediaSegments.words : sql<null>`null`,
            reviewStatus: schema.mediaSegments.reviewStatus,
          })
          .from(schema.mediaSegments)
          .where(and(
            eq(schema.mediaSegments.mediaVersionId, selected.version.id),
            eq(schema.mediaSegments.reviewStatus, "approved"),
          ))
          .orderBy(schema.mediaSegments.segmentIndex),
        summariesByItemIds([selected.item.id]),
      ]);
      const media = projectCard(selected, progress.get(selected.version.id)?.progress ?? null, requestedAt, summaries.get(selected.item.id) ?? null);
      if (!media) throw new MediaUnavailableError();
      return projectMediaPlayback({
        card: media,
        asset: {
          kind: selected.asset.kind,
          url: selected.asset.playbackUrl,
          expiresAt: selected.asset.playbackExpiresAt,
        },
        segments: segments.map((segment) => ({
          id: segment.id,
          index: segment.segmentIndex,
          startMs: segment.startMs,
          endMs: segment.endMs,
          sourceText: segment.sourceText,
          translation: segment.translation,
          speaker: segment.speaker,
          words: includeWords ? segment.words ?? null : null,
          reviewStatus: segment.reviewStatus,
        })),
      }, requestedAt);
    },

    async saveProgress(userId, stableKey, version, input, updatedAt) {
      return database.transaction(async (transaction) => {
        const [target] = await transaction
          .select({ id: schema.mediaVersions.id, durationMs: schema.mediaVersions.durationMs })
          .from(schema.mediaVersions)
          .innerJoin(
            schema.mediaItems,
            and(
              eq(schema.mediaItems.id, schema.mediaVersions.mediaItemId),
              eq(schema.mediaItems.currentVersion, schema.mediaVersions.version),
            ),
          )
          .innerJoin(
            schema.mediaAssets,
            eq(schema.mediaAssets.mediaVersionId, schema.mediaVersions.id),
          )
          .where(and(
            eq(schema.mediaItems.stableKey, stableKey),
            eq(schema.mediaVersions.version, version),
            eq(schema.mediaVersions.status, "published"),
            eq(schema.mediaVersions.copyrightStatus, "cleared"),
            eq(schema.mediaAssets.availability, "available"),
            or(
              isNull(schema.mediaAssets.playbackExpiresAt),
              gt(schema.mediaAssets.playbackExpiresAt, updatedAt),
            ),
          ))
          .limit(1);
        if (!target) throw new MediaUnavailableError();

        if (input.lastSegmentIndex !== null) {
          const [segment] = await transaction
            .select({ id: schema.mediaSegments.id })
            .from(schema.mediaSegments)
            .where(and(
              eq(schema.mediaSegments.mediaVersionId, target.id),
              eq(schema.mediaSegments.segmentIndex, input.lastSegmentIndex),
              eq(schema.mediaSegments.reviewStatus, "approved"),
            ))
            .limit(1);
          if (!segment) throw new Error("MEDIA_PROGRESS_INVALID");
        }

        const [current] = await transaction
          .select()
          .from(schema.userMediaProgress)
          .where(and(
            eq(schema.userMediaProgress.userId, userId),
            eq(schema.userMediaProgress.mediaVersionId, target.id),
          ))
          .limit(1)
          .for("update");
        const next = nextMediaProgress(
          current ? progressRecord(current) : null,
          input,
          target.durationMs,
        );
        if (current && next.revision === current.revision) return next;

        if (!current) {
          const inserted = await transaction
            .insert(schema.userMediaProgress)
            .values({
              userId,
              mediaVersionId: target.id,
              lastPositionMs: next.lastPositionMs,
              lastSegmentIndex: next.lastSegmentIndex,
              status: next.status,
              revision: next.revision,
              lastOpenedAt: updatedAt,
              updatedAt,
            })
            .onConflictDoNothing({
              target: [schema.userMediaProgress.userId, schema.userMediaProgress.mediaVersionId],
            })
            .returning();
          if (inserted.length !== 1) throw new MediaProgressConflictError();
          return next;
        }

        const updated = await transaction
          .update(schema.userMediaProgress)
          .set({
            lastPositionMs: next.lastPositionMs,
            lastSegmentIndex: next.lastSegmentIndex,
            status: next.status,
            revision: next.revision,
            lastOpenedAt: updatedAt,
            updatedAt,
          })
          .where(and(
            eq(schema.userMediaProgress.id, current.id),
            eq(schema.userMediaProgress.revision, input.expectedRevision),
          ))
          .returning();
        if (updated.length !== 1) throw new MediaProgressConflictError();
        return next;
      });
    },
  };
}
