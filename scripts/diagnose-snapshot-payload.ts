/**
 * Is the materialised snapshot transferring more than the page uses?
 *
 * A cold page read fetches the example text for every shelf word at once, and
 * that read is now slow enough to trip the page's 30 s timeout. The display clip
 * is 180 characters (`FREQUENCY_CONTEXT_MAX_CHARS`), so if the stored text is
 * much longer than that, the transfer is carrying bytes that are discarded
 * immediately after they arrive.
 *
 * Read-only, and it only asks for lengths rather than the text itself.
 */
import { config as loadDotEnv } from "dotenv";

import postgres from "postgres";

loadDotEnv({ quiet: true });

const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connection) {
  console.log("no database connection configured");
  process.exit(1);
}

const sql = postgres(connection, { max: 1, prepare: false, connect_timeout: 30 });

try {
  const [shape] = await sql`
    select
      count(*)::int as rows,
      min(length(example_text))::int as min_len,
      round(avg(length(example_text)))::int as avg_len,
      percentile_disc(0.5) within group (order by length(example_text))::int as median_len,
      percentile_disc(0.95) within group (order by length(example_text))::int as p95_len,
      max(length(example_text))::int as max_len,
      round(avg(length(example_title)))::int as avg_title_len
    from lexicon_form_frequencies
  `;
  console.log("stored example shape:", JSON.stringify(shape));

  const over = await sql`
    select
      count(*) filter (where length(example_text) > 180)::int as over_180,
      count(*) filter (where length(example_text) > 400)::int as over_400,
      count(*) filter (where length(example_text) > 1000)::int as over_1000,
      sum(length(example_text))::bigint as total_chars,
      sum(least(length(example_text), 180))::bigint as total_if_clipped
    from lexicon_form_frequencies
  `;
  const o = over[0];
  const total = Number(o.total_chars);
  const clipped = Number(o.total_if_clipped);
  console.log(
    `rows over 180 chars: ${o.over_180} | over 400: ${o.over_400} | over 1000: ${o.over_1000}`,
  );
  console.log(
    `total text: ${(total / 1024 / 1024).toFixed(1)} MB → clipped to 180: ${(clipped / 1024 / 1024).toFixed(1)} MB`,
  );
  console.log(
    `reduction: ${(100 - (clipped / total) * 100).toFixed(0)}% (${(total / clipped).toFixed(1)}x smaller)`,
  );

  // How much would a shelf-shaped read (the 7,922 reference words) actually carry?
  const [shelf] = await sql`
    select
      count(*)::int as rows,
      sum(length(example_text))::bigint as chars,
      sum(least(length(example_text), 180))::bigint as chars_if_clipped
    from lexicon_form_frequencies
    where word in (select word from lexicon_form_frequencies limit 7922)
  `;
  console.log(
    `shelf-shaped read: ${shelf.rows} rows, ${(Number(shelf.chars) / 1024 / 1024).toFixed(1)} MB → ${(Number(shelf.chars_if_clipped) / 1024 / 1024).toFixed(1)} MB clipped`,
  );

  const started = Date.now();
  const sample = await sql`
    select word, left(example_text, 180) as clipped
    from lexicon_form_frequencies limit 500
  `;
  console.log(`read 500 rows clipped to 180 chars: ${Date.now() - started} ms (${sample.length} rows)`);
} catch (error) {
  console.log("probe failed:", String(error).slice(0, 300));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
