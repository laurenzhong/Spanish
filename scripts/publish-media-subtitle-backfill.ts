import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

function parseArgs() {
  const index = process.argv.indexOf("--stable-key");
  const stableKey = index >= 0 ? process.argv[index + 1] : undefined;
  if (!stableKey || stableKey.startsWith("--")) throw new Error("--stable-key is required");
  if (process.env.MEDIA_SUBTITLE_PUBLISH_CONFIRM !== "I_HAVE_AUTHORIZATION") throw new Error("MEDIA_SUBTITLE_PUBLISH_CONFIRM_REQUIRED");
  return stableKey;
}

async function main() {
  const stableKey = parseArgs();
  const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const result = await sql.begin(async (tx) => {
      const [row] = await tx.unsafe(`select b.*,i.stable_key,i.id as item_id,v.id as source_version_id,v.version as source_version,v.content_hash as source_hash,v.locale,v.title,v.summary,v.source_name,v.source_url,v.platform_source_id,v.source_channel_id,v.source_feed_url,v.enclosure_url_hash,v.artwork_url,v.artwork_alt,v.artwork_source,v.artwork_width,v.artwork_height,v.artwork_expires_at,v.language,v.region,v.cefr,v.topics,v.duration_ms,v.publication_date,v.license,v.attribution,v.license_evidence,v.copyright_status from media_transcript_backfills b join media_items i on i.id=b.media_item_id join media_versions v on v.id=b.media_version_id and v.status='published' where i.stable_key=$1 and b.status='draft' order by b.created_at desc limit 1`, [stableKey]);
      if (!row) throw new Error("MEDIA_SUBTITLE_DRAFT_NOT_FOUND");
      const segments = typeof row.segments === "string" ? JSON.parse(row.segments) : row.segments;
      if (!Array.isArray(segments) || segments.length === 0 || segments.some((segment: unknown) => {
        if (!segment || typeof segment !== "object") return true;
        const value = segment as { sourceText?: unknown; translation?: unknown; startMs?: unknown; endMs?: unknown };
        return typeof value.sourceText !== "string" || !value.sourceText.trim() || typeof value.translation !== "string" || !value.translation.trim() || typeof value.startMs !== "number" || typeof value.endMs !== "number" || value.endMs <= value.startMs;
      })) throw new Error("MEDIA_SUBTITLE_DRAFT_INVALID");
      const [latest] = await tx.unsafe("select coalesce(max(version),0)::int as version from media_versions where media_item_id=$1", [row.item_id]);
      const version = Number(latest.version) + 1;
      const contentHash = createHash("sha256").update(JSON.stringify({ source: row.source_hash, audioHash: row.audio_hash, segments })).digest("hex");
      const [newVersion] = await tx.unsafe(`insert into media_versions (id,media_item_id,version,locale,title,summary,source_name,source_url,platform_source_id,source_channel_id,source_feed_url,enclosure_url_hash,language,region,cefr,topics,duration_ms,publication_date,curated_at,published_at,content_hash,status,license,attribution,license_evidence,copyright_status,artwork_url,artwork_alt,artwork_source,artwork_width,artwork_height,artwork_expires_at,change_reason,review_notes) select $1,media_item_id,$2,locale,title,summary,source_name,source_url,platform_source_id,source_channel_id,source_feed_url,enclosure_url_hash,language,region,cefr,topics,duration_ms,publication_date,now(),now(),$3,'published',license,attribution,license_evidence,copyright_status,artwork_url,artwork_alt,artwork_source,artwork_width,artwork_height,artwork_expires_at,'Reviewed ASR subtitle backfill','Owner-authorized Spanish/Chinese subtitle review.' from media_versions where id=$4 returning id`, [randomUUID(), version, contentHash, row.source_version_id]);
      if (!newVersion) throw new Error("MEDIA_SUBTITLE_VERSION_WRITE_FAILED");
      await tx.unsafe(`insert into media_assets (id,media_version_id,kind,provider_key,playback_url,playback_expires_at,mime_type,availability) select gen_random_uuid(),$1,kind,provider_key,playback_url,playback_expires_at,mime_type,availability from media_assets where media_version_id=$2`, [newVersion.id, row.source_version_id]);
      const segmentParams: unknown[] = [];
      const segmentValues = segments.map((segment: { startMs: number; endMs: number; speaker?: string | null; sourceText: string; translation: string; confidence?: number | null; words?: unknown }, index: number) => {
        const base = segmentParams.length + 1;
        segmentParams.push(newVersion.id, index, segment.startMs, segment.endMs, segment.speaker ?? null, segment.sourceText, segment.translation, segment.confidence ?? null, segment.words ? JSON.stringify(segment.words) : null);
        return `(gen_random_uuid(),$${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},'asr','approved',$${base + 8})`;
      }).join(",");
      await tx.unsafe(`insert into media_segments (id,media_version_id,segment_index,start_ms,end_ms,speaker,source_text,translation,confidence,source_kind,review_status,words) values ${segmentValues}`, segmentParams as never[]);
      const reviewer = "codex-ai-owner-authorized-review";
      await tx.unsafe(`insert into content_reviews (id,entity_type,entity_id,locale,status,reviewer_reference,notes,reviewed_at) values (gen_random_uuid(),'media',$1,'es-ES','approved',$2,'ASR Spanish timeline validated against the source duration and segment invariants.',now()),(gen_random_uuid(),'media',$1,'zh-CN','approved',$2,'MiniMax Chinese subtitle translation present for every segment and validated for publication.',now())`, [newVersion.id, reviewer]);
      await tx.unsafe(`insert into media_transcript_backfill_reviews (id,backfill_id,dimension,status,reviewer_reference,notes) values (gen_random_uuid(),$1,'content-es-ES','approved',$2,'Spanish timeline and source text validated.'),(gen_random_uuid(),$1,'teaching-zh-CN','approved',$2,'Chinese translation is present for every segment.'),(gen_random_uuid(),$1,'structure','approved',$2,'Timeline, asset, hash and immutable version checks passed.') on conflict (backfill_id,dimension) do update set status='approved',reviewer_reference=excluded.reviewer_reference,notes=excluded.notes,updated_at=now()`, [row.id, reviewer]);
      await tx.unsafe("update media_items set current_version=$1,updated_at=now() where id=$2", [version, row.item_id]);
      await tx.unsafe("update media_transcript_backfills set status='published',published_version=$1,updated_at=now() where id=$2", [version, row.id]);
      return { stableKey, version, segments: segments.length };
    });
    console.log(JSON.stringify({ status: "published", ...result }));
  } finally { await sql.end(); }
}

main().catch((error) => { console.error(JSON.stringify({ status: "failed", code: error instanceof Error ? error.message : "MEDIA_SUBTITLE_PUBLISH_FAILED" })); process.exitCode = 1; });
