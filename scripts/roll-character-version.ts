import "dotenv/config";

import { sql } from "drizzle-orm";

import { getDatabase } from "../src/shared/db/client";

/**
 * Re-points a user's conversation data from one released revision of a
 * character to the next one.
 *
 * Why this exists: the runtime resolves a character row by
 * (stableKey, characterVersion, published) and keys a conversation on
 * (userId, characterId). A new revision is therefore a different row with a
 * different id, so publishing v2 without this step would leave the history on
 * v1 and open a second, empty conversation. `content/characters/lucia.json`
 * stays versioned and append-only; only the pointers move.
 *
 * Design constraints, both enforced below:
 *   - Version *content* never moves. `character_canon_facts` and
 *     `character_relationships` belong to the revision that declared them, so
 *     v1 keeps its own rows as immutable history.
 *   - The allowlist is checked against information_schema, so a foreign key
 *     added later aborts the run instead of being silently skipped.
 *
 * Dry run by default; `--apply` writes inside one transaction.
 */

const moveAllowlist: readonly Readonly<{ table: string; column: string; reason: string }>[] = [
  { table: "conversations", column: "character_id", reason: "the chat itself; unique on (user, character)" },
  { table: "messages", column: "character_id", reason: "message rows carry their character" },
  { table: "conversation_preferences", column: "character_id", reason: "pin, mute and read state; unique on (user, character)" },
  { table: "proactive_message_candidates", column: "character_id", reason: "proactive dedupe state for the current day" },
  { table: "character_introduction_offers", column: "source_character_id", reason: "offers this character made stay with the character" },
  { table: "character_introduction_offers", column: "target_character_id", reason: "offers naming this character as the target; the table has no version column of its own" },
];

/** Foreign keys that intentionally keep pointing at the old revision. */
const versionContentTables: readonly string[] = [
  "character_canon_facts",
  "character_relationships",
  "relationship_memories",
  "memory_sharing_permissions",
];

function argument(name: string): string | null {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : null;
}

async function foreignKeys(): Promise<readonly Readonly<{ table: string; column: string }>[]> {
  const database = getDatabase();
  const result = await database.execute(sql`
    select tc.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public' and ccu.table_name = 'characters'
  `);
  return (result as unknown as Array<Record<string, unknown>>).map((row) => ({
    table: String(row.table_name),
    column: String(row.column_name),
  }));
}

async function main(): Promise<void> {
  const stableKey = argument("character") ?? "lucia";
  const fromVersion = Number(argument("from") ?? "1");
  const toVersion = Number(argument("to") ?? "2");
  const apply = process.argv.includes("--apply");
  const database = getDatabase();

  const rows = (await database.execute(sql`
    select id, character_version, status from characters
    where stable_key = ${stableKey} and character_version in (${fromVersion}, ${toVersion})
    order by character_version
  `)) as unknown as Array<Record<string, unknown>>;
  const from = rows.find((row) => Number(row.character_version) === fromVersion);
  const to = rows.find((row) => Number(row.character_version) === toVersion);
  if (!from) throw new Error(`${stableKey}@${fromVersion} does not exist; nothing to move from.`);
  if (!to) throw new Error(`${stableKey}@${toVersion} does not exist; import and publish it first.`);
  if (String(to.status) !== "published") throw new Error(`${stableKey}@${toVersion} is ${String(to.status)}, not published.`);
  console.log(`moving ${stableKey}: v${fromVersion} ${String(from.id)} -> v${toVersion} ${String(to.id)}`);

  const discovered = await foreignKeys();
  const missing = discovered.filter((reference) =>
    !moveAllowlist.some((entry) => entry.table === reference.table && entry.column === reference.column)
    && !versionContentTables.includes(reference.table));
  if (missing.length > 0) {
    throw new Error(`unclassified foreign keys referencing characters: ${missing.map((row) => `${row.table}.${row.column}`).join(", ")}. Update the allowlist deliberately.`);
  }

  const counts: Array<Readonly<{ table: string; column: string; rows: number; reason: string }>> = [];
  for (const entry of moveAllowlist) {
    const result = (await database.execute(
      sql`select count(*)::int as count from ${sql.identifier(entry.table)} where ${sql.identifier(entry.column)} = ${String(from.id)}`,
    )) as unknown as Array<Record<string, unknown>>;
    counts.push({ ...entry, rows: Number(result[0]?.count ?? 0) });
  }
  console.log("\nrows to re-point:");
  for (const entry of counts) console.log(`  ${entry.table}.${entry.column}: ${entry.rows} (${entry.reason})`);
  console.log(`  kept on v${fromVersion} (version content): ${versionContentTables.join(", ")}`);
  console.log(`\ntotal: ${counts.reduce((sum, entry) => sum + entry.rows, 0)} rows`);

  if (!apply) {
    console.log("\ndry run: nothing written. Re-run with --apply to move these rows in one transaction.");
    process.exit(0);
  }

  await database.transaction(async (transaction) => {
    for (const entry of counts) {
      const updated = (await transaction.execute(
        sql`update ${sql.identifier(entry.table)} set ${sql.identifier(entry.column)} = ${String(to.id)}
            where ${sql.identifier(entry.column)} = ${String(from.id)} returning 1 as moved`,
      )) as unknown as Array<Record<string, unknown>>;
      if (updated.length !== entry.rows) {
        throw new Error(`${entry.table}: moved ${updated.length} rows but the dry run counted ${entry.rows}.`);
      }
      console.log(`moved ${updated.length} rows in ${entry.table}`);
    }
  });
  console.log("\napplied. Re-run without --apply to confirm zero rows remain on the old revision.");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "character version rollover failed");
  process.exitCode = 1;
});
