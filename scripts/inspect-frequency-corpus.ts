/**
 * Read-only: how many distinct word forms does the frequency shelf have to draw
 * on, and what does the current head of the distribution look like?
 *
 * Answers whether "8000 words" is a number this corpus can even produce, before
 * anyone decides what to change.
 */
import { config as loadDotEnv } from "dotenv";
import { sql } from "drizzle-orm";

import { createDatabaseConnection } from "../src/shared/db/client";

loadDotEnv({ quiet: true });

const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connection) {
  console.log("no database connection configured");
  process.exit(1);
}

const { client, db } = createDatabaseConnection(connection);

try {
  const [{ segments }] = await db.execute<{ segments: number }>(sql`
    with source_texts as (
      select ms.source_text as text
      from media_segments ms
      inner join media_versions mv on mv.id = ms.media_version_id
      where ms.review_status = 'approved' and mv.status = 'published' and mv.copyright_status = 'cleared'
      union all
      select seg.source_text
      from article_segments seg
      inner join article_versions av on av.id = seg.article_version_id
      inner join article_sources src on src.id = av.source_id
      where av.status = 'published' and src.copyright_status = 'cleared'
        and not exists (select 1 from user_generated_articles uga where uga.article_version_id = av.id)
    )
    select count(*)::int as segments from source_texts
  `);
  console.log(`source segments in scope: ${segments}`);

  const [{ words }] = await db.execute<{ words: number }>(sql`
    with source_texts as (
      select ms.source_text as text
      from media_segments ms
      inner join media_versions mv on mv.id = ms.media_version_id
      where ms.review_status = 'approved' and mv.status = 'published' and mv.copyright_status = 'cleared'
      union all
      select seg.source_text
      from article_segments seg
      inner join article_versions av on av.id = seg.article_version_id
      inner join article_sources src on src.id = av.source_id
      where av.status = 'published' and src.copyright_status = 'cleared'
        and not exists (select 1 from user_generated_articles uga where uga.article_version_id = av.id)
    ), tokens as (
      select regexp_split_to_table(regexp_replace(lower(text), '[^a-záéíóúüñ]+', ' ', 'g'), ' ') as word
      from source_texts
    )
    select count(distinct word)::int as words from tokens where length(word) > 2
  `);
  console.log(`distinct word forms (length > 2): ${words}`);

  const head = await db.execute<{ word: string; n: number }>(sql`
    with source_texts as (
      select ms.source_text as text
      from media_segments ms
      inner join media_versions mv on mv.id = ms.media_version_id
      where ms.review_status = 'approved' and mv.status = 'published' and mv.copyright_status = 'cleared'
      union all
      select seg.source_text
      from article_segments seg
      inner join article_versions av on av.id = seg.article_version_id
      inner join article_sources src on src.id = av.source_id
      where av.status = 'published' and src.copyright_status = 'cleared'
        and not exists (select 1 from user_generated_articles uga where uga.article_version_id = av.id)
    ), tokens as (
      select regexp_split_to_table(regexp_replace(lower(text), '[^a-záéíóúüñ]+', ' ', 'g'), ' ') as word
      from source_texts
    )
    select word, count(*)::int as n from tokens where length(word) > 2 group by word order by n desc limit 25
  `);
  console.log("\ntop 25 by raw surface frequency:");
  for (const row of head) console.log(`  ${String(row.n).padStart(6)}  ${row.word}`);
} finally {
  await client.end({ timeout: 5 });
}
