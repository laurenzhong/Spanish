/**
 * Verify the materialised form-frequency path against the REAL database.
 *
 * Read-only. Two things are checked, and the second one is the acceptance test:
 *
 * 1. **Field-by-field equality.** For every reference-list form, the counts the
 *    live scan produces and the counts the materialised table stores must match
 *    exactly — count, example text and example title — and the headline figures
 *    the owner reconciled by hand (`ser`, `todo`, `ya`, and the shelf total) are
 *    printed for eyeballing.
 * 2. **The rendered page.** The same three views the earlier reconciliation used
 *    (first page, a deep page, a search) are printed as canonical lines, so a
 *    run with `--source=live` and a run with `--source=materialised` can be
 *    diffed without trusting anything else.
 *
 * The equality check runs inside one process and does not go through the
 * repository's snapshot cache: `loadLiveFormFrequencyRows()` and
 * `readMaterialisedFormFrequencyRows()` are called directly, so both sources are
 * read from the same connection in the same window. Timing is measured the way
 * the shelf sees it — one cold `listFrequencyWords()` per process — because the
 * hosted pooler drifts between runs; alternate the two modes instead of
 * comparing numbers taken minutes apart.
 *
 * Run:
 *   node --conditions=react-server --import tsx/esm scripts/verify-frequency-materialisation.ts
 *   node --conditions=react-server --import tsx/esm scripts/verify-frequency-materialisation.ts --source=live
 */
import { config as loadDotEnv } from "dotenv";

import { createDatabaseConnection } from "../src/shared/db/client";
import { contentFrequencyWords } from "../src/modules/lexicon-corpus/domain/frequency-word-list";
import {
  loadLiveFormFrequencyRows,
  readCorpusFormFrequencyState,
  readMaterialisedFormFrequencyRows,
  resolveCorpusFrequencySource,
  wantedFormList,
} from "../src/modules/lexicon-corpus/repositories/corpus-form-frequency";
import { createDrizzleLexiconCorpusRepository } from "../src/modules/lexicon-corpus/repositories/drizzle-lexicon-corpus-repository";

loadDotEnv({ quiet: true });

const args = process.argv.slice(2);
const requested = args.find((arg) => arg.startsWith("--source="))?.slice("--source=".length);
if (requested === "live" || requested === "materialised") process.env.LEXICON_FREQUENCY_SOURCE = requested;

const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connection) {
  console.log("no database connection configured");
  process.exit(1);
}

const { client, db } = createDatabaseConnection(connection);
const results: string[] = [];
const check = (label: string, passed: boolean, detail = ""): void => {
  results.push(`${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/** Flagship figures the owner reconciled by hand, so a regression is obvious. */
const HEADLINES = ["ser", "todo", "ya"] as const;

try {
  console.log("=== source ===");
  console.log(`  LEXICON_FREQUENCY_SOURCE = ${process.env.LEXICON_FREQUENCY_SOURCE ?? "(unset)"}`);
  console.log(`  resolved source          = ${resolveCorpusFrequencySource()}`);

  const state = await readCorpusFormFrequencyState(db);
  console.log("\n=== materialisation state ===");
  console.log(`  refreshed at  ${state ? state.refreshedAt.toISOString() : "(never refreshed)"}`);
  console.log(`  form count    ${state ? state.formCount : "(none)"}`);
  if (state) {
    const ageHours = (Date.now() - state.refreshedAt.getTime()) / 3_600_000;
    console.log(`  age           ${ageHours.toFixed(2)} h`);
  }

  // ---------------------------------------------------------------- equality
  console.log("\n=== field-by-field equality (live scan vs materialised table) ===");
  const live = await loadLiveFormFrequencyRows(db);
  const stored = await readMaterialisedFormFrequencyRows(db, wantedFormList());
  check("the materialised table is usable", stored.status === "ok", stored.status);
  if (stored.status === "ok") {
    const liveByWord = new Map(live.map((row) => [row.word, row]));
    const storedByWord = new Map(stored.rows.map((row) => [row.word, row]));
    const missing = [...liveByWord.keys()].filter((word) => !storedByWord.has(word));
    const extra = [...storedByWord.keys()].filter((word) => !liveByWord.has(word));
    check("every live form is in the table", missing.length === 0, missing.slice(0, 8).join(", "));
    check("the table holds no form the live scan does not", extra.length === 0, extra.slice(0, 8).join(", "));

    let countMismatches = 0;
    let exampleTextMismatches = 0;
    let exampleTitleMismatches = 0;
    for (const [word, row] of liveByWord) {
      const other = storedByWord.get(word);
      if (!other) continue;
      if (other.n !== row.n) countMismatches += 1;
      if ((other.example[0] ?? "") !== (row.example[0] ?? "")) exampleTextMismatches += 1;
      if ((other.example[1] ?? "") !== (row.example[1] ?? "")) exampleTitleMismatches += 1;
    }
    check("counts match for every form", countMismatches === 0, `${countMismatches} mismatch(es) of ${liveByWord.size}`);
    check("example texts match for every form", exampleTextMismatches === 0, `${exampleTextMismatches} mismatch(es)`);
    check("example titles match for every form", exampleTitleMismatches === 0, `${exampleTitleMismatches} mismatch(es)`);
    console.log(`  live forms ${liveByWord.size}, materialised forms ${storedByWord.size}`);
  }

  // ------------------------------------------------------------ the shelf page
  const repository = createDrizzleLexiconCorpusRepository(db);
  console.log("\n=== cold and warm shelf page ===");
  const coldStart = Date.now();
  const page = await repository.listFrequencyWords({ page: 1, pageSize: 25 });
  const coldMs = Date.now() - coldStart;
  const warmStart = Date.now();
  await repository.listFrequencyWords({ page: 1, pageSize: 25 });
  const warmMs = Date.now() - warmStart;
  console.log(`  cold  ${coldMs} ms`);
  console.log(`  warm  ${warmMs} ms`);
  console.log(`  total ${page.total}`);

  const deep = await repository.listFrequencyWords({ page: 300, pageSize: 25 });
  const searched = await repository.listFrequencyWords({ search: "aqui", page: 1, pageSize: 8 });

  console.log(`\n--- rows (source ${process.env.LEXICON_FREQUENCY_SOURCE ?? "default"}) ---`);
  const rowLine = (item: (typeof page.items)[number]): string =>
    `row ${item.word}\t${item.occurrenceCount}\t${item.context ?? "-"}\t${item.sourceTitle ?? "-"}`;
  console.log(`total ${page.total}\trows ${page.items.length + Math.min(6, deep.items.length) + searched.items.length}`);
  for (const item of page.items) console.log(rowLine(item));
  for (const item of deep.items.slice(0, 6)) console.log(rowLine(item));
  for (const item of searched.items) console.log(rowLine(item));

  console.log("\n--- headline counts ---");
  const byWord = new Map(page.items.map((item) => [item.word, item]));
  for (const word of HEADLINES) {
    const found = byWord.get(word);
    console.log(`  ${word.padEnd(6)} ${found ? found.occurrenceCount : "(not on the first page)"}`);
  }

  // ---------------------------------------------------------------- verdict
  console.log("");
  for (const line of results) console.log(line);
  const failures = results.filter((line) => line.startsWith("FAIL")).length;
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  if (failures > 0) process.exitCode = 1;

  // Keep the shelf's own reference list in the output: a total that drifts
  // because the list changed is not a corpus problem, and this makes that visible.
  console.log(`reference list length: ${contentFrequencyWords().length}`);
} catch (error) {
  console.log("verification failed:", String((error as { cause?: unknown }).cause ?? error).slice(0, 600));
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
