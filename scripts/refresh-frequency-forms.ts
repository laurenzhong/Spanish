/**
 * Refresh the materialised form-frequency table.
 *
 * The vocabulary shelf's counts come from `lexicon_form_frequencies`, which is
 * filled by this script and by nothing else. Publishing or withdrawing content
 * does **not** refresh it, so the numbers are as of the last run of this script:
 *
 * - run it after a content publish/withdraw batch (the daily content pipeline is
 *   the natural place; nightly is the documented cadence);
 * - between runs the shelf serves numbers that are up to `refresh interval +
 *   refresh duration` old — about 24 h at the documented cadence;
 * - the bound is enforced, not just documented: past 36 h the read path ignores
 *   the table and runs the live scan, so a forgotten refresh costs latency
 *   instead of accuracy (and logs the reason).
 *
 * Re-running is safe and idempotent: the new rows and the state row land in one
 * transaction, so a reader sees the previous complete set or the new one.
 *
 * Run: node --conditions=react-server --import tsx/esm scripts/refresh-frequency-forms.ts
 */
import { config as loadDotEnv } from "dotenv";

import { createDatabaseConnection } from "../src/shared/db/client";
import {
  readCorpusFormFrequencyState,
  refreshCorpusFormFrequency,
} from "../src/modules/lexicon-corpus/repositories/corpus-form-frequency";

loadDotEnv({ quiet: true });

const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connection) {
  console.log("no database connection configured");
  process.exit(1);
}

const { client, db } = createDatabaseConnection(connection);

try {
  const previous = await readCorpusFormFrequencyState(db);
  console.log("=== refresh lexicon form frequencies ===");
  console.log(
    `  previous refresh   ${
      previous ? `${previous.refreshedAt.toISOString()} (${previous.formCount} forms)` : "(never)"
    }`,
  );

  const started = Date.now();
  const result = await refreshCorpusFormFrequency(db, new Date());
  const elapsed = Date.now() - started;

  console.log(`  forms written      ${result.forms}`);
  console.log(`  refreshed at       ${result.refreshedAt.toISOString()}`);
  console.log(`  duration           ${elapsed} ms`);

  const confirmed = await readCorpusFormFrequencyState(db);
  console.log(`  state row          ${confirmed ? `${confirmed.refreshedAt.toISOString()} (${confirmed.formCount} forms)` : "(missing!)"}`);

  console.log(
    "\ncounts are now as of this moment. Content published or withdrawn after this run is not\n"
      + "reflected until the next run; the shelf falls back to the live scan after 36 h without one.",
  );
} catch (error) {
  console.log("refresh failed:", String((error as { cause?: unknown }).cause ?? error).slice(0, 600));
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
