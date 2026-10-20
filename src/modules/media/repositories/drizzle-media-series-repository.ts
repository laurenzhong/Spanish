import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

import { assertContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";
import { MediaUnavailableError, projectMediaCard, type MediaCard, type RawMediaProjection } from "../domain/media";
import { MediaSeriesError, type MediaSeriesDescriptor, type MediaSeriesSummary } from "../domain/media-series";
import { mediaSeriesKeySchema, saveMediaSeriesCommandSchema, type MediaSeriesEpisodesQuery } from "../schemas/media-series";
import type { MediaSeriesEpisodes, MediaSeriesRepository, MediaSeriesView } from "./media-series-repository";

type EpisodeRow = Omit<RawMediaProjection, "publishedAt" | "curatedAt" | "artwork"> & {
  publishedAt: string | null; curatedAt: string; artwork: null | Omit<NonNullable<RawMediaProjection["artwork"]>, "expiresAt"> & { expiresAt: string | null };
  series: MediaSeriesSummary; position: number | null; rn: number;
};
type ReadResult = {
  descriptor: MediaSeriesView | null; rows: EpisodeRow[]; current: EpisodeRow | null; previous: EpisodeRow | null; next: EpisodeRow | null;
  fingerprint: string | null; offset: number; currentVisible: boolean;
};
function resultRows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}
function card(row: EpisodeRow | null, now: Date): MediaCard | null {
  if (!row) return null;
  const projected = projectMediaCard({ ...row, publishedAt: row.publishedAt ? new Date(row.publishedAt) : null, curatedAt: new Date(row.curatedAt),
    artwork: row.artwork ? { ...row.artwork, expiresAt: row.artwork.expiresAt ? new Date(row.artwork.expiresAt) : null } : null }, now);
  return projected ? { ...projected, series: row.series } : null;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
function descriptor(row: typeof schema.mediaSeries.$inferSelect): MediaSeriesDescriptor {
  return { seriesKey: row.seriesKey, title: row.title, summary: row.summary, kind: row.kind, orderMode: row.orderMode, status: row.status, revision: row.revision };
}
const unavailable = () => new MediaSeriesError("MEDIA_SERIES_NOT_AVAILABLE");
const membershipConflict = () => new MediaSeriesError("MEDIA_SERIES_MEMBERSHIP_CONFLICT");

export function createDrizzleMediaSeriesRepository(database: Database, dependencies: { now?: () => Date } = {}): MediaSeriesRepository {
  const now = dependencies.now ?? (() => new Date());

  // One statement: count, cursor fingerprint, neighbors, and bounded cards see
  // the same publication snapshot. No subtitles or private global cache.
  async function read(seriesKey: string | null, anchor: string | null, userId: string, pageSize: number, offset: number | null, recommended = false): Promise<ReadResult> {
    const requestedAt = now();
    const result = await database.execute(sql`
      with selected_series as (
        select s.* from media_series s where s.status = 'active' and (
          s.series_key = ${seriesKey}::text or (${seriesKey}::text is null and s.id = (
            select m.series_id from media_series_memberships m join media_items i on i.id=m.media_item_id where i.stable_key=${anchor}::text
          ))
        )
      ), available as (
        select i.stable_key as "stableKey", i.kind, v.version, v.title, v.summary, v.source_name as "sourceName",
          v.language, v.region, v.cefr, v.topics, v.duration_ms as "durationMs", v.publication_date as "publishedAt",
          v.curated_at as "curatedAt", v.content_hash as "contentHash", v.status, v.copyright_status as "copyrightStatus", true as playable,
          case when v.artwork_url is not null and v.artwork_alt is not null and v.artwork_source is not null then jsonb_build_object(
            'url',v.artwork_url,'alt',v.artwork_alt,'source',v.artwork_source,'width',v.artwork_width,'height',v.artwork_height,'expiresAt',v.artwork_expires_at) else null end as artwork,
          case when p.id is not null then jsonb_build_object('lastPositionMs',p.last_position_ms,'lastSegmentIndex',p.last_segment_index,'status',p.status,'revision',p.revision) else null end as progress,
          m.series_id, m.position, s.order_mode, s.revision as series_revision,
          case when s.id is not null then jsonb_build_object('seriesKey',s.series_key,'title',s.title,'kind',s.kind,'orderMode',s.order_mode,
            'revision',s.revision,'seasonNumber',m.season_number,'episodeNumber',m.episode_number,'episodeLabel',m.episode_label) else null end as series
        from media_items i join media_versions v on v.media_item_id=i.id and v.version=i.current_version
        join lateral (select a.id from media_assets a where a.media_version_id=v.id and a.availability='available'
          and (a.playback_expires_at is null or a.playback_expires_at>${requestedAt.toISOString()}::timestamptz)
          and (i.kind='podcast' or (i.kind='video' and a.kind='video' and a.provider_key='bunny-storage')) limit 1) a on true
        left join user_media_progress p on p.media_version_id=v.id and p.user_id=${userId}::uuid
        left join media_series_memberships m on m.media_item_id=i.id
        left join selected_series s on s.id=m.series_id
        where v.status='published' and v.copyright_status='cleared'
          and (m.series_id=(select id from selected_series) or i.stable_key=${anchor}::text)
      ), visible as (
        select * from available where series_id=(select id from selected_series)
      ), ranked as (
        select *, row_number() over (order by case when order_mode='ordered' then position end asc nulls last,
          case when order_mode='episodic' then "publishedAt" end desc nulls last,"stableKey") as rn from visible
      ), location as (
        select coalesce(${offset}::int, ((select rn::int-1 from ranked where "stableKey"=${anchor}::text)/${Math.max(1, pageSize)})*${pageSize},0) as start
      ), descriptor as (
        select s.series_key as "seriesKey",s.title,s.summary,s.kind,s.order_mode as "orderMode",s.status,s.revision,
          (select count(*)::int from visible) as "episodeCount" from selected_series s where exists(select 1 from visible)
      )
      select (select to_jsonb(d) from descriptor d) as descriptor,
        coalesce((select jsonb_agg(to_jsonb(chosen)) from (
          select * from ranked where case when ${recommended} then "stableKey"<>${anchor}::text else rn>(select start from location) and rn<=(select start from location)+${pageSize} end
          order by case when ${recommended} and order_mode='ordered' and position>(select position from ranked where "stableKey"=${anchor}::text) then 0 else 1 end,rn
          limit ${recommended ? 6 : pageSize}
        ) chosen),'[]'::jsonb) as rows,
        (select to_jsonb(r) from ranked r where "stableKey"=${anchor}::text) as current,
        (select to_jsonb(r) from ranked r where rn=(select rn-1 from ranked where "stableKey"=${anchor}::text)) as previous,
        (select to_jsonb(r) from ranked r where rn=(select rn+1 from ranked where "stableKey"=${anchor}::text)) as next,
        (select md5(string_agg("stableKey"||'@'||version,',' order by "stableKey")) from visible) as fingerprint,
        (select start from location) as offset,
        exists(select 1 from available where "stableKey"=${anchor}::text) as "currentVisible"
    `);
    return resultRows<ReadResult>(result)[0];
  }
  function context(result: ReadResult, pageSize: number) {
    return createHash("sha256").update(canonical([result.descriptor?.seriesKey, result.descriptor?.revision, result.fingerprint, pageSize])).digest("hex");
  }
  function parseCursor(value?: string): { context: string; offset: number } | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { context: string; offset: number };
      if (!/^[a-f0-9]{64}$/u.test(parsed.context) || !Number.isSafeInteger(parsed.offset) || parsed.offset <= 0 || parsed.offset > 2_147_483_647) throw new Error();
      return parsed;
    } catch { throw new MediaSeriesError("MEDIA_SERIES_CURSOR_INVALID"); }
  }
  return {
    async getSeries(seriesKey, userId) {
      const result = await read(seriesKey, null, userId, 0, 0);
      if (!result.descriptor) throw unavailable();
      return result.descriptor;
    },
    async listEpisodes(seriesKey, query: MediaSeriesEpisodesQuery, userId): Promise<MediaSeriesEpisodes> {
      const cursor = parseCursor(query.cursor);
      const result = await read(seriesKey, query.anchorMediaKey ?? null, userId, query.pageSize, cursor?.offset ?? null);
      if (!result.descriptor) throw unavailable();
      const signature = context(result, query.pageSize);
      if (cursor && (cursor.context !== signature || cursor.offset >= result.descriptor.episodeCount)) throw new MediaSeriesError("MEDIA_SERIES_CURSOR_INVALID");
      if (query.anchorMediaKey && !result.current) throw new MediaSeriesError("MEDIA_SERIES_QUERY_INVALID");
      const items = result.rows.flatMap((row) => { const projected = card(row, now()); return projected ? [projected] : []; });
      const end = Number(result.offset) + items.length;
      const hasMore = end < result.descriptor.episodeCount;
      return { series: result.descriptor, items, anchor: { current: card(result.current, now()), previous: card(result.previous, now()), next: card(result.next, now()) },
        nextCursor: hasMore ? Buffer.from(JSON.stringify({ context: signature, offset: end })).toString("base64url") : null, hasMore };
    },
    async recommendations(stableKey, userId) {
      const result = await read(null, stableKey, userId, 6, 0, true);
      if (!result.currentVisible) throw new MediaUnavailableError();
      if (!result.descriptor || !result.current || result.descriptor.kind !== "video") return { series: null, items: [] };
      return { series: result.descriptor, items: result.rows.flatMap((row) => { const projected = card(row, now()); return projected ? [projected] : []; }) };
    },
    async save(seriesKey, input, ownerUserId) {
      ownerUserId = ownerUserId.toLowerCase();
      assertContentWorkflowOwner(ownerUserId);
      mediaSeriesKeySchema.parse(seriesKey);
      const command = saveMediaSeriesCommandSchema.parse(input);
      const requestHash = createHash("sha256").update(canonical(command)).digest("hex");
      return database.transaction(async (transaction) => {
        // Owner-only Alpha writes are rare. A catalogue table lock also covers
        // creation and cross-series moves; no race between missing-row checks.
        await transaction.execute(sql`lock table media_series in share row exclusive mode`);
        const [existing] = await transaction.select().from(schema.mediaSeries).where(eq(schema.mediaSeries.seriesKey, seriesKey));
        if (existing) {
          const [replay] = await transaction.select().from(schema.mediaSeriesChanges).where(and(eq(schema.mediaSeriesChanges.seriesId, existing.id), eq(schema.mediaSeriesChanges.idempotencyKey, command.idempotencyKey)));
          if (replay) {
            if (replay.requestHash !== requestHash || replay.actorUserId !== ownerUserId) throw new MediaSeriesError("MEDIA_SERIES_IDEMPOTENCY_CONFLICT");
            return replay.afterState.series as MediaSeriesDescriptor;
          }
        }
        if ((existing?.revision ?? 0) !== command.expectedRevision) throw new MediaSeriesError("MEDIA_SERIES_REVISION_CONFLICT");
        const keys = [...command.members.map((member) => member.stableKey), ...command.removeStableKeys];
        const items = keys.length ? await transaction.select().from(schema.mediaItems).where(inArray(schema.mediaItems.stableKey, keys)) : [];
        if (items.length !== keys.length || items.some((item) => item.kind !== command.kind)) throw membershipConflict();
        const ids = items.map((item) => item.id);
        const oldMemberships = ids.length ? await transaction.select({ member: schema.mediaSeriesMemberships, series: schema.mediaSeries, stableKey: schema.mediaItems.stableKey })
          .from(schema.mediaSeriesMemberships).innerJoin(schema.mediaSeries, eq(schema.mediaSeries.id, schema.mediaSeriesMemberships.seriesId))
          .innerJoin(schema.mediaItems, eq(schema.mediaItems.id, schema.mediaSeriesMemberships.mediaItemId)).where(inArray(schema.mediaSeriesMemberships.mediaItemId, ids)) : [];
        const movedFrom = new Map<string, typeof schema.mediaSeries.$inferSelect>();
        for (const row of oldMemberships) {
          if (row.series.seriesKey !== seriesKey) {
            if (command.removeStableKeys.includes(row.stableKey) || command.fromSeriesRevisions[row.series.seriesKey] === undefined) throw membershipConflict();
            if (command.fromSeriesRevisions[row.series.seriesKey] !== row.series.revision) throw new MediaSeriesError("MEDIA_SERIES_REVISION_CONFLICT");
            movedFrom.set(row.series.seriesKey, row.series);
          }
        }
        if (Object.keys(command.fromSeriesRevisions).some((key) => !movedFrom.has(key))) throw membershipConflict();
        if (command.removeStableKeys.some((key) => !oldMemberships.some((row) => row.stableKey === key && row.series.seriesKey === seriesKey))) throw membershipConflict();
        const changedAt = now();
        // Delete touched rows first to permit an atomic swap of occupied positions.
        if (ids.length) await transaction.delete(schema.mediaSeriesMemberships).where(inArray(schema.mediaSeriesMemberships.mediaItemId, ids));
        const values = { title: command.title, summary: command.summary, kind: command.kind, orderMode: command.orderMode, status: command.status,
          revision: (existing?.revision ?? 0) + 1, updatedAt: changedAt };
        const [saved] = existing ? await transaction.update(schema.mediaSeries).set(values).where(eq(schema.mediaSeries.id, existing.id)).returning()
          : await transaction.insert(schema.mediaSeries).values({ ...values, seriesKey }).returning();
        if (command.members.length) await transaction.insert(schema.mediaSeriesMemberships).values(command.members.map((member) => ({
          mediaItemId: items.find((item) => item.stableKey === member.stableKey)!.id, seriesId: saved.id, position: member.position,
          seasonNumber: member.seasonNumber, episodeNumber: member.episodeNumber, episodeLabel: member.episodeLabel,
          evidence: [...member.evidence], confirmedBy: ownerUserId, confirmedAt: changedAt,
        })));
        const snapshot = descriptor(saved);
        await transaction.insert(schema.mediaSeriesChanges).values({ seriesId: saved.id, idempotencyKey: command.idempotencyKey, requestHash,
          expectedRevision: command.expectedRevision, actorUserId: ownerUserId, reason: command.reason, evidence: [...command.evidence],
          beforeState: { series: existing ? descriptor(existing) : null, members: oldMemberships.map((row) => row.member) },
          afterState: { series: snapshot, members: command.members, removed: command.removeStableKeys }, createdAt: changedAt });
        for (const source of movedFrom.values()) {
          const [updated] = await transaction.update(schema.mediaSeries).set({ revision: source.revision + 1, updatedAt: changedAt }).where(eq(schema.mediaSeries.id, source.id)).returning();
          await transaction.insert(schema.mediaSeriesChanges).values({ seriesId: source.id, idempotencyKey: `${command.idempotencyKey}:to:${seriesKey}`, requestHash,
            expectedRevision: source.revision, actorUserId: ownerUserId, reason: command.reason, evidence: [...command.evidence],
            beforeState: { series: descriptor(source), members: oldMemberships.filter((row) => row.series.id === source.id).map((row) => row.member) },
            afterState: { series: descriptor(updated), movedTo: seriesKey }, createdAt: changedAt });
        }
        return snapshot;
      }).catch((error: unknown) => {
        const details = error as { cause?: { code?: string }; code?: string };
        if (["23505", "23514", "23503"].includes(details.code ?? details.cause?.code ?? "")) throw membershipConflict();
        throw error;
      });
    },
  };
}
