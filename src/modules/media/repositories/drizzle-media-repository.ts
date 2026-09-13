import { Buffer } from "node:buffer";

import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";

import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

import {
  MediaProgressConflictError,
  MediaUnavailableError,
  nextMediaProgress,
  projectMediaCard,
  projectMediaPlayback,
  type MediaCard,
  type MediaProgress,
} from "../domain";
import type { ParsedMediaListQuery } from "../schemas";
import type { MediaLookupResult, MediaRepository } from "./media-repository";

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
): MediaRepository {
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
