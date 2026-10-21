import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

/**
 * Correct `media_versions.duration_ms` when it disagrees with the asset that is
 * actually served.
 *
 * Why this needs a script rather than an UPDATE: a published version is
 * immutable evidence. `duration_ms` feeds the player's progress clamp and the
 * `lastPositionMs <= duration_ms` invariant, and the Bunny migration refuses to
 * publish an asset whose decoded duration disagrees with it, so a wrong value
 * both misreports the timeline and blocks repair of the hosting itself. The
 * correction therefore republishes the same content as a new version, with the
 * measured duration and a review trail, and leaves the old version intact.
 *
 * The measured duration must come from decoding the served asset (ffprobe) and
 * must cover every approved segment, otherwise the segment timeline invariant
 * (`segment.endMs <= durationMs`) would be broken by the correction.
 *
 * Usage:
 *   MEDIA_DURATION_CONFIRM=I_HAVE_AUTHORIZATION \
 *   tsx scripts/correct-media-duration.ts --stable-key <key> --duration-ms <measured>
 */
function parseArgs() {
  const index = process.argv.indexOf("--stable-key");
  const stableKey = index >= 0 ? process.argv[index + 1] : undefined;
  if (!stableKey || stableKey.startsWith("--")) throw new Error("--stable-key is required");
  const durationIndex = process.argv.indexOf("--duration-ms");
  const raw = durationIndex >= 0 ? process.argv[durationIndex + 1] : undefined;
  const durationMs = Number(raw);
  if (!raw || raw.startsWith("--") || !Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error("--duration-ms must be a positive integer");
  if (process.env.MEDIA_DURATION_CONFIRM !== "I_HAVE_AUTHORIZATION") throw new Error("MEDIA_DURATION_CONFIRM_REQUIRED");
  return { stableKey, durationMs };
}

async function main() {
  const { stableKey, durationMs } = parseArgs();
  const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const result = await sql.begin(async (tx) => {
      const [row] = await tx.unsafe(
        `select v.id as source_version_id, v.version as source_version, v.duration_ms, i.id as item_id, i.stable_key,
                (select max(s.end_ms) from media_segments s where s.media_version_id = v.id and s.review_status='approved') as last_end,
                (select count(*) from media_segments s where s.media_version_id = v.id and s.review_status='approved') as segment_count
         from media_items i
         join media_versions v on v.media_item_id = i.id and v.version = i.current_version and v.status='published'
         where i.stable_key = $1
         for update of i, v`,
        [stableKey],
      );
      if (!row) throw new Error("MEDIA_VERSION_NOT_FOUND");
      const storedDurationMs = Number(row.duration_ms);
      const lastEnd = row.last_end === null ? null : Number(row.last_end);
      if (storedDurationMs === durationMs) throw new Error("MEDIA_DURATION_UNCHANGED");
      // The corrected value must still contain every approved segment.
      if (lastEnd !== null && durationMs < lastEnd) throw new Error(`MEDIA_DURATION_BELOW_LAST_SEGMENT:${durationMs}<${lastEnd}`);

      const [latest] = await tx.unsafe("select coalesce(max(version),0)::int as version from media_versions where media_item_id=$1", [row.item_id]);
      const version = Number(latest.version) + 1;
      const changeReason = `Corrected duration_ms from ${storedDurationMs} to ${durationMs} after decoding the served asset`;
      const contentHash = createHash("sha256")
        .update(JSON.stringify({ source_version: row.source_version_id, duration_ms: durationMs, segments: Number(row.segment_count) }))
        .digest("hex");

      const [newVersion] = await tx.unsafe(
        `insert into media_versions
           (id,media_item_id,version,locale,title,summary,source_name,source_url,platform_source_id,source_channel_id,source_feed_url,
            enclosure_url_hash,language,region,cefr,topics,duration_ms,publication_date,curated_at,published_at,content_hash,status,
            license,attribution,license_evidence,copyright_status,artwork_url,artwork_alt,artwork_source,artwork_width,artwork_height,
            artwork_expires_at,change_reason,review_notes)
         select $1,media_item_id,$2,locale,title,summary,source_name,source_url,platform_source_id,source_channel_id,source_feed_url,
            enclosure_url_hash,language,region,cefr,topics,$3,publication_date,now(),now(),$4,'published',
            license,attribution,license_evidence,copyright_status,artwork_url,artwork_alt,artwork_source,artwork_width,artwork_height,
            artwork_expires_at,$5,$6
         from media_versions where id=$7 returning id`,
        [randomUUID(), version, durationMs, contentHash, changeReason, "Owner-authorized duration correction; content and segments are byte-identical to the previous version.", row.source_version_id],
      );
      if (!newVersion) throw new Error("MEDIA_DURATION_VERSION_WRITE_FAILED");

      await tx.unsafe(
        `insert into media_assets (id,media_version_id,kind,provider_key,playback_url,playback_expires_at,mime_type,availability)
         select gen_random_uuid(),$1,kind,provider_key,playback_url,playback_expires_at,mime_type,availability
         from media_assets where media_version_id=$2`,
        [newVersion.id, row.source_version_id],
      );
      await tx.unsafe(
        `insert into media_segments (id,media_version_id,segment_index,start_ms,end_ms,speaker,source_text,translation,confidence,source_kind,review_status,words)
         select gen_random_uuid(),$1,segment_index,start_ms,end_ms,speaker,source_text,translation,confidence,source_kind,review_status,words
         from media_segments where media_version_id=$2`,
        [newVersion.id, row.source_version_id],
      );
      // Owner-authorized AI review identity for records written after the 2026-10-10
      // Codex -> DSH platform migration. Historical rows keep their `codex-*` value.
      const reviewer = "dsh-ai-owner-authorized-review";
      await tx.unsafe(
        `insert into content_reviews (id,entity_type,entity_id,locale,status,reviewer_reference,notes,reviewed_at)
         values (gen_random_uuid(),'media',$1,'es-ES','approved',$2,$3,now()),
                (gen_random_uuid(),'media',$1,'zh-CN','approved',$2,$4,now())`,
        [newVersion.id, reviewer,
          `Duration corrected to the decoded asset length (${durationMs} ms; previous ${storedDurationMs} ms). Spanish segments are unchanged.`,
          `Duration corrected to the decoded asset length (${durationMs} ms; previous ${storedDurationMs} ms). Chinese translations are unchanged.`],
      );
      await tx.unsafe("update media_items set current_version=$1, updated_at=now() where id=$2", [version, row.item_id]);
      return { stableKey, version, previousDurationMs: storedDurationMs, durationMs, segments: Number(row.segment_count), lastEnd };
    });
    console.log(JSON.stringify({ status: "corrected", ...result }));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", code: error instanceof Error ? error.message : "MEDIA_DURATION_CORRECTION_FAILED" }));
  process.exitCode = 1;
});
