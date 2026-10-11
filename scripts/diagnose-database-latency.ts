/**
 * Diagnose where the latency actually is.
 *
 * The shelf's cold page went from ~0.4 s to 15.5 s. The materialised snapshot is
 * ~6,300 rows and the database reported 20 ms of execution for it, so 15 s is
 * almost certainly not query work. This separates the layers instead of guessing:
 * connection setup, per-statement round trip, the real query, and the payload.
 *
 * Read-only.
 */
import { config as loadDotEnv } from "dotenv";
import { Socket } from "node:net";

import postgres from "postgres";

loadDotEnv({ quiet: true });

const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connection) {
  console.log("no database connection configured");
  process.exit(1);
}
const url = new URL(connection);
const host = url.hostname;
const port = Number(url.port || 5432);

/** Time a raw TCP handshake, which needs no credentials and no SQL. */
const tcp = (): Promise<number> =>
  new Promise((resolve) => {
    const started = Date.now();
    const socket = new Socket();
    const done = (): void => {
      socket.destroy();
      resolve(Date.now() - started);
    };
    socket.setTimeout(8000, done);
    socket.once("connect", done);
    socket.once("error", done);
    socket.connect(port, host);
  });

const timeIt = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const started = Date.now();
  const value = await fn();
  return [value, Date.now() - started];
};

console.log(`host ${host}:${port}`);
console.log(`tcp handshake: ${await tcp()} ms`);

const [sql, connectMs] = await timeIt(async () =>
  postgres(connection, { max: 1, prepare: false, connect_timeout: 30 }),
);
// The first statement pays authentication on top of the handshake.
const [, firstMs] = await timeIt(() => sql`select 1 as n`);
console.log(`connect + auth: ${connectMs} ms | first statement: ${firstMs} ms`);

for (let i = 0; i < 3; i += 1) {
  const [, ms] = await timeIt(() => sql`select 1 as n`);
  console.log(`  select 1 round trip ${i + 1}: ${ms} ms`);
}

const [, countMs] = await timeIt(
  () => sql`select count(*)::int as n from lexicon_form_frequencies`,
);
console.log(`count rows (materialised table): ${countMs} ms`);

const [, stateMs] = await timeIt(
  () => sql`select refreshed_at, form_count from lexicon_form_frequency_state where id = 'corpus'`,
);
console.log(`state row: ${stateMs} ms`);

// The real cold-path read, including the payload the page actually fetches.
const [rows, fullMs] = await timeIt(
  () =>
    sql`select word, occurrence_count, example_title, example_text from lexicon_form_frequencies`,
);
const bytes = rows.reduce(
  (total, row) =>
    total + String(row.word).length + String(row.example_text).length + String(row.example_title).length,
  0,
);
console.log(`materialised read (full payload): ${fullMs} ms | ${rows.length} rows | ~${Math.round(bytes / 1024)} KB of text`);

// Is the server itself busy, or is it waiting on IO/locks?
const [activity] = await sql`
  select
    (select count(*)::int from pg_stat_activity where datname = current_database()) as connections,
    (select count(*)::int from pg_stat_activity where datname = current_database() and state = 'active') as active,
    (select count(*)::int from pg_stat_activity where datname = current_database() and wait_event_type is not null) as waiting,
    pg_database_size(current_database()) as db_bytes,
    current_setting('server_version') as version
`;
console.log(
  `server: connections=${activity.connections} active=${activity.active} waiting=${activity.waiting} size=${(Number(activity.db_bytes) / 1024 / 1024).toFixed(1)} MB version=${activity.version}`,
);

const [, ioMs] = await timeIt(
  () => sql`select count(*)::int as n from article_segments`,
);
console.log(`article_segments count (a big table, forces IO): ${ioMs} ms`);

await sql.end({ timeout: 5 });
