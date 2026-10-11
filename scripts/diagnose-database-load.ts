/**
 * Second probe: is the server busy, blocked, or throttled?
 *
 * The first probe showed network round trips of ~240 ms (normal for this
 * region) but `select 1` at 240 ms against a historical 75 ms, a 503 ms count
 * over a 6,296-row table, and a full read of that table exceeding the server's
 * statement timeout. So the instance itself is slow. This checks whether it is
 * our own concurrency, a lock, or the planner.
 *
 * Read-only, short statements only.
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
  const [limits] = await sql`
    select
      current_setting('statement_timeout') as statement_timeout,
      current_setting('idle_in_transaction_session_timeout') as idle_tx_timeout,
      current_setting('max_connections') as max_connections,
      current_setting('shared_buffers') as shared_buffers
  `;
  console.log("server limits:", JSON.stringify(limits));

  const [counts] = await sql`
    select
      count(*)::int as total,
      count(*) filter (where state = 'active')::int as active,
      count(*) filter (where state = 'idle')::int as idle,
      count(*) filter (where wait_event_type = 'Lock')::int as lock_waiting,
      count(*) filter (where wait_event_type = 'IO')::int as io_waiting,
      count(*) filter (where application_name <> '')::int as named
    from pg_stat_activity
    where datname = current_database()
  `;
  console.log("activity:", JSON.stringify(counts));

  const [blocked] = await sql`
    select count(*)::int as blocked from pg_locks where not granted
  `;
  console.log(`ungranted locks: ${blocked.blocked}`);

  // Repeat a trivial statement to see whether the slowness is steady or spiky.
  const samples: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const started = Date.now();
    await sql`select 1 as n`;
    samples.push(Date.now() - started);
  }
  console.log(`select 1 samples: ${samples.join(", ")} ms`);
  console.log(
    `  min ${Math.min(...samples)} | median ${[...samples].sort((a, b) => a - b)[3]} | max ${Math.max(...samples)}`,
  );

  // Plan the read that timed out, without executing it.
  const plan = await sql`
    explain (costs off) select word, occurrence_count, example_title, example_text
    from lexicon_form_frequencies
  `;
  console.log("plan for the timed-out read:", plan.map((row) => row["QUERY PLAN"]).join(" | "));

  const [tableInfo] = await sql`
    select
      pg_total_relation_size('lexicon_form_frequencies') as total_bytes,
      (select count(*)::int from lexicon_form_frequencies) as rows
  `;
  console.log(
    `table: ${tableInfo.rows} rows, ${(Number(tableInfo.total_bytes) / 1024).toFixed(0)} KB on disk`,
  );

  // A chunked read, to see whether the timeout is about volume or about the server.
  const started = Date.now();
  const chunk = await sql`
    select word, occurrence_count, example_title, example_text
    from lexicon_form_frequencies limit 1000
  `;
  console.log(`read 1000 rows: ${Date.now() - started} ms (${chunk.length} returned)`);
} catch (error) {
  console.log("probe failed:", String(error).slice(0, 300));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
