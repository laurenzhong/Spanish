import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createDatabaseConnection } from "../src/shared/db/client";
import { sql } from "drizzle-orm";

const connection = createDatabaseConnection(process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!);
try {
  const applied = await connection.db.execute(sql`select hash from drizzle.__drizzle_migrations`);
  const hashes = new Set(applied.map((row) => row.hash));
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
  const pending: string[] = [];
  for (const entry of journal.entries) {
    const hash = createHash("sha256").update(await readFile(`drizzle/${entry.tag}.sql`, "utf8")).digest("hex");
    if (!hashes.has(hash)) pending.push(entry.tag);
  }
  console.log(JSON.stringify({ pendingMigrations: pending }));
  const rows = await connection.db.execute(sql`select i.stable_key, i.kind, v.version, v.duration_ms,
    count(s.id)::int as segments, count(s.translation)::int as translated
    from media_items i join media_versions v on v.media_item_id=i.id and v.version=i.current_version
    left join media_segments s on s.media_version_id=v.id and s.review_status='approved'
    where v.status='published' and v.copyright_status='cleared'
    group by i.stable_key, i.kind, v.version, v.duration_ms order by i.kind, i.stable_key`);
  console.log(JSON.stringify(rows));
  const backfills = await connection.db.execute(sql`select b.id, b.status, b.created_at, i.stable_key, jsonb_array_length(b.segments) as segments from media_transcript_backfills b join media_items i on i.id=b.media_item_id order by b.created_at desc limit 5`);
  console.log(JSON.stringify({ recentBackfills: backfills }));
  const [reviewCoverage] = await connection.db.execute(sql`select
    count(distinct b.id)::int as published_backfills,
    count(r.id) filter (where r.status='approved')::int as approved_reviews,
    count(r.id) filter (where r.status='approved' and r.reviewer_reference='codex-ai-owner-authorized-review')::int as ai_owner_reviews,
    count(distinct (b.id, r.dimension)) filter (where r.status='approved')::int as approved_dimensions
    from media_transcript_backfills b
    join media_items i on i.id=b.media_item_id and i.current_version=b.published_version
    left join media_transcript_backfill_reviews r on r.backfill_id=b.id
    where b.status='published'`);
  console.log(JSON.stringify({ reviewCoverage }));
} finally { await connection.client.end(); }
