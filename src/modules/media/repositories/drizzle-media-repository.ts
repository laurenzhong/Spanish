import { Buffer } from "node:buffer";

import { and, desc, eq, gt, inArray, isNull, max, or } from "drizzle-orm";

import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

import {
  MediaProgressConflictError,
  validateSegmentTimeline,
  MediaUnavailableError,
  nextMediaProgress,
  projectMediaCard,
  projectMediaPlayback,
  type MediaCard,
  type MediaProgress,
} from "../domain";
import type { ParsedMediaListQuery } from "../schemas";
import type { MediaLookupResult, MediaRepository } from "./media-repository";
import type { AcquiredPodcastRepository } from "./acquired-podcast-repository";
import type { AcquiredVideoRepository } from "./acquired-video-repository";

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

function projectCard(row: JoinedRow, progress: MediaProgress | null, now: Date): MediaCard | null {
  return projectMediaCard({
    stableKey: row.item.stableKey,
    version: row.version.version,
    kind: row.item.kind,
    title: row.version.title,
    summary: row.version.summary,
    sourceName: row.version.sourceName,
    language: row.version.language,
    region: row.version.region,
    cefr: row.version.cefr as "A2" | "B1" | null,
    topics: row.version.topics,
    durationMs: row.version.durationMs,
    publishedAt: row.version.publicationDate,
    curatedAt: row.version.curatedAt,
    contentHash: row.version.contentHash,
    status: row.version.status,
    copyrightStatus: row.version.copyrightStatus as "unverified" | "cleared" | "restricted",
    playable: isPlayable(row, now),
    progress,
  });
}

function encodeCursor(item: MediaCard): string {
  return Buffer.from(JSON.stringify({ id: item.id }), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { id?: unknown };
    if (typeof parsed.id !== "string") throw new Error();
    return parsed.id;
  } catch {
    throw new Error("MEDIA_CURSOR_INVALID");
  }
}

function matches(item: MediaCard, query: ParsedMediaListQuery): boolean {
  if (query.kind && item.kind !== query.kind) return false;
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

  async function joinedRows(stableKey?: string): Promise<JoinedRow[]> {
    const published = and(
      eq(schema.mediaVersions.status, "published"),
      eq(schema.mediaVersions.copyrightStatus, "cleared"),
      eq(schema.mediaAssets.availability, "available"),
    );
    return database
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
      .where(stableKey ? and(published, eq(schema.mediaItems.stableKey, stableKey)) : published)
      .orderBy(desc(schema.mediaVersions.curatedAt), schema.mediaItems.stableKey)
      .limit(500);
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

  async function lookup(stableKey: string, userId?: string): Promise<MediaLookupResult> {
    const rows = await joinedRows(stableKey);
    if (rows.length === 0) return { reason: "not_found", media: null };
    const selected = rows.find((row) => isPlayable(row, now()));
    if (!selected) return { reason: "unavailable", media: null };
    const progress = await progressByVersion(userId, [selected.version.id]);
    const media = projectCard(selected, progress.get(selected.version.id)?.progress ?? null, now());
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
      const playbackExpiresAt = new Date(input.draft.playbackExpiresAt);
      if (
        feedUrl.protocol !== "https:"
        || enclosureUrl.protocol !== "https:"
        || feedUrl.username
        || feedUrl.password
        || enclosureUrl.username
        || enclosureUrl.password
        || Number.isNaN(playbackExpiresAt.getTime())
        || playbackExpiresAt.getTime() <= input.publishedAt.getTime()
      ) {
        throw new AcquiredPodcastPersistenceConflictError("The podcast playback asset is not safely usable at publication time.");
      }
      const transcriptMatches = input.draft.transcriptStatus === "unavailable"
        ? input.draft.transcriptUrl === null && input.draft.segments.length === 0
        : input.draft.transcriptUrl !== null && input.draft.segments.length > 0
          && input.draft.segments.every((segment) => segment.sourceKind === input.draft.transcriptStatus);
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
          providerKey: "podcast-rss",
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
          kind: "official_embed",
          providerKey: "youtube",
          playbackUrl: input.draft.embedUrl,
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

    async list(query, userId) {
      const rows = await joinedRows();
      const selected = new Map<string, JoinedRow>();
      for (const row of rows) {
        if (!selected.has(row.item.stableKey) && isPlayable(row, now())) selected.set(row.item.stableKey, row);
      }
      const progress = await progressByVersion(userId, [...selected.values()].map((row) => row.version.id));
      const itemsWithActivity = [...selected.values()].flatMap((row) => {
        const stored = progress.get(row.version.id);
        const item = projectCard(row, stored?.progress ?? null, now());
        return item && matches(item, query) ? [{ item, lastOpenedAt: stored?.lastOpenedAt ?? null }] : [];
      });
      if (query.sort === "newest") {
        itemsWithActivity.sort((left, right) => (right.item.publishedAt ?? "").localeCompare(left.item.publishedAt ?? ""));
      }
      if (query.sort === "recently_played") {
        itemsWithActivity.sort((left, right) => (right.lastOpenedAt?.getTime() ?? 0) - (left.lastOpenedAt?.getTime() ?? 0));
      }
      let items = itemsWithActivity.map(({ item }) => item);
      const cursorId = decodeCursor(query.cursor);
      if (cursorId) {
        const index = items.findIndex((item) => item.id === cursorId);
        if (index < 0) throw new Error("MEDIA_CURSOR_INVALID");
        items = items.slice(index + 1);
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

    async getPlayback(stableKey, userId, requestedAt) {
      const rows = await joinedRows(stableKey);
      const selected = rows.find((row) => isPlayable(row, requestedAt));
      if (!selected) throw new MediaUnavailableError();
      const progress = await progressByVersion(userId, [selected.version.id]);
      const media = projectCard(selected, progress.get(selected.version.id)?.progress ?? null, requestedAt);
      if (!media) throw new MediaUnavailableError();
      const segments = await database
        .select()
        .from(schema.mediaSegments)
        .where(eq(schema.mediaSegments.mediaVersionId, selected.version.id))
        .orderBy(schema.mediaSegments.segmentIndex)
        .limit(500);
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
