/**
 * Verify the vocabulary shelf against the REAL database.
 *
 * The shelf change was verified only on PGlite with hand-written stubs for the
 * article and media tables, because that session had no database connection.
 * The ordering does not depend on those tables — it comes from the reference
 * list — but the occurrence counts and the context enrichment do, and a
 * user-visible ordering was never once rendered from real data.
 *
 * Read-only.
 */
import { config as loadDotEnv } from "dotenv";

import { createDatabaseConnection } from "../src/shared/db/client";
import { createDrizzleLexiconCorpusRepository } from "../src/modules/lexicon-corpus/repositories/drizzle-lexicon-corpus-repository";
import { contentFrequencyWords } from "../src/modules/lexicon-corpus/domain/frequency-word-list";

loadDotEnv({ quiet: true });

const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connection) {
  console.log("no database connection configured");
  process.exit(1);
}

const { client, db } = createDatabaseConnection(connection);
const repository = createDrizzleLexiconCorpusRepository(db);

try {
  console.log("=== reference list ===");
  const shelf = contentFrequencyWords();
  console.log(`  shelf words: ${shelf.length}`);

  console.log("\n=== first page, real database ===");
  const started = Date.now();
  const page = await repository.listFrequencyWords({ page: 1, pageSize: 25 });
  const elapsedFirst = Date.now() - started;
  console.log(`  total: ${page.total} | page ${page.page} of ${Math.ceil(page.total / page.pageSize)}`);
  console.log(`  first page took ${elapsedFirst} ms`);
  for (const item of page.items) {
    const badge = item.occurrenceCount === 0 ? "—" : String(item.occurrenceCount);
    const context = item.context ? item.context.slice(0, 60) : "(no context)";
    console.log(`    ${item.word.padEnd(14)} ${badge.padStart(6)}  ${context}`);
  }

  console.log("\n=== a warm second call (cache) ===");
  const warmStart = Date.now();
  await repository.listFrequencyWords({ page: 1, pageSize: 25 });
  console.log(`  ${Date.now() - warmStart} ms`);

  console.log("\n=== a deep page, to prove rank-7000 words are reachable ===");
  const deepStart = Date.now();
  const deep = await repository.listFrequencyWords({ page: 300, pageSize: 25 });
  console.log(`  page 300 took ${Date.now() - deepStart} ms`);
  for (const item of deep.items.slice(0, 6)) {
    console.log(`    ${item.word.padEnd(18)} ${item.occurrenceCount === 0 ? "—" : item.occurrenceCount}`);
  }

  console.log("\n=== function words must be gone from the head ===");
  const headWords = page.items.map((item) => item.word);
  const banned = ["el", "la", "los", "las", "que", "de", "por", "con", "una", "para", "del", "y", "en", "no"];
  const present = banned.filter((word) => headWords.includes(word));
  console.log(`  function words in the first 25: ${present.length === 0 ? "none" : present.join(", ")}`);

  console.log("\n=== the essential verbs must still be there ===");
  const verbs = ["ser", "estar", "haber", "tener", "ir", "hacer", "poder", "decir"];
  const missing = verbs.filter((verb) => !shelf.some((word) => word.word === verb));
  console.log(`  missing essential verbs: ${missing.length === 0 ? "none" : missing.join(", ")}`);

  console.log("\n=== search still resolves and keeps order ===");
  const searched = await repository.listFrequencyWords({ search: "aqui", page: 1, pageSize: 8 });
  for (const item of searched.items) console.log(`    ${item.word.padEnd(14)} ${item.occurrenceCount}`);
} catch (error) {
  console.log("verification failed:", String(error).slice(0, 600));
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
