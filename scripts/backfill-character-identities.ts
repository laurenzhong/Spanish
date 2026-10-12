import "dotenv/config";

import { sql, type SQL } from "drizzle-orm";

import { getDatabase } from "../src/shared/db/client";

/**
 * Backfills the character identity introduced by ADR 0014 / slice 1 of
 * `docs/plans/2026-10-12-character-identity-implementation-plan.md`.
 *
 * A `characters` row is one *revision* (`stable_key` + `character_version`), and
 * user state currently points at that revision's row id. Slice 1 adds
 * `character_identities` plus a nullable `identity_id` next to every existing
 * `character_id`, so a later slice can point user state at a revision-independent
 * identity and publishing a new revision becomes one pointer update.
 *
 * This script performs the two backfill steps that make the new columns usable
 * while the old ones keep working:
 *   1. one `character_identities` row per distinct `characters.stable_key`, with
 *      `current_character_id` = the newest published revision of that key and a
 *      fallback to the newest revision overall when nothing is published yet;
 *   2. `identity_id` on each user-state row, matched through the revision row the
 *      row already points at (`character_id`; `source_character_id` /
 *      `target_character_id` for introduction offers).
 *
 * Version content (`character_canon_facts`, `characters.profile.relationships`)
 * deliberately keeps pointing at the revision: it belongs to that revision.
 * `messages.character_id` also stays as the audit source of who generated the
 * message.
 *
 * Dry run by default: it only reads. `--apply` does everything inside one
 * transaction and re-checks every count the dry run reported.
 */

type BackfillTarget = Readonly<{
  table: string;
  characterColumn: string;
  identityColumn: string;
  reason: string;
}>;

const backfillTargets: readonly BackfillTarget[] = [
  { table: "conversations", characterColumn: "character_id", identityColumn: "identity_id", reason: "the chat itself; unique on (user, character)" },
  { table: "messages", characterColumn: "character_id", identityColumn: "identity_id", reason: "message rows keep character_id as the audit source" },
  { table: "conversation_preferences", characterColumn: "character_id", identityColumn: "identity_id", reason: "pin, mute and read state" },
  { table: "proactive_message_candidates", characterColumn: "character_id", identityColumn: "identity_id", reason: "proactive dedupe state" },
  { table: "character_relationships", characterColumn: "character_id", identityColumn: "identity_id", reason: "status, stage and summary with this character" },
  { table: "relationship_memories", characterColumn: "character_id", identityColumn: "identity_id", reason: "memories this character holds about the user" },
  { table: "memory_sharing_permissions", characterColumn: "target_character_id", identityColumn: "target_identity_id", reason: "who a memory may be shared with" },
  { table: "character_introduction_offers", characterColumn: "source_character_id", identityColumn: "source_identity_id", reason: "the offer's source character" },
  { table: "character_introduction_offers", characterColumn: "target_character_id", identityColumn: "target_identity_id", reason: "the offer's target character" },
];

/** Tables whose `characters` foreign key is version content, not user state. */
const versionContentTables: readonly string[] = [
  "character_canon_facts",
  "characters",
];

type IdentityPlanRow = Readonly<{
  stableKey: string;
  currentCharacterId: string;
  characterVersion: number;
  status: string;
}>;

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return result as unknown as Array<Record<string, unknown>>;
}

async function scalar(query: SQL): Promise<number> {
  const database = getDatabase();
  const result = rowsOf(await database.execute(query));
  return Number(result[0]?.count ?? 0);
}

/** One identity per stable key, pointing at its newest published revision. */
async function planIdentities(): Promise<readonly IdentityPlanRow[]> {
  const database = getDatabase();
  const result = await database.execute(sql`
    select distinct on (stable_key)
      stable_key,
      id as current_character_id,
      character_version,
      status
    from characters
    order by stable_key, (status = 'published') desc, character_version desc
  `);
  return rowsOf(result).map((row) => ({
    stableKey: String(row.stable_key),
    currentCharacterId: String(row.current_character_id),
    characterVersion: Number(row.character_version),
    status: String(row.status),
  }));
}

async function existingStableKeys(): Promise<readonly string[]> {
  const database = getDatabase();
  const result = await database.execute(sql`select stable_key from character_identities`);
  return rowsOf(result).map((row) => String(row.stable_key));
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const database = getDatabase();

  const planned = await planIdentities();
  const existing = await existingStableKeys();
  const existingKeys = new Set(existing);
  const toCreate = planned.filter((row) => !existingKeys.has(row.stableKey));

  console.log(`identities: ${planned.length} stable key(s) in characters, ${existing.length} already present, ${toCreate.length} to create`);
  for (const row of planned) {
    const marker = existingKeys.has(row.stableKey) ? "exists" : "create";
    const pointer = `${row.stableKey}@${row.characterVersion} (${row.status})`;
    console.log(`  [${marker}] ${row.stableKey} -> ${pointer} ${row.currentCharacterId}`);
  }

  // The plan doubles as the matching rule, so the counts are correct on the very
  // first run, before any identity row exists. Rows are matched by the
  // `stable_key` of the revision they point at, never by revision id.
  const plan = planned.length > 0
    ? sql`(values ${sql.join(
        planned.map((row) => sql`(${row.stableKey})`),
        sql`, `,
      )}) as plan(stable_key)`
    : null;

  type TargetReport = Readonly<{
    target: BackfillTarget;
    toSet: number;
    leftNull: number;
    unresolvable: number;
  }>;

  const reports: TargetReport[] = [];
  for (const target of backfillTargets) {
    if (!plan) {
      reports.push({ target, toSet: 0, leftNull: 0, unresolvable: 0 });
      continue;
    }
    const toSet = await scalar(sql`
      select count(*)::int as count
      from ${sql.identifier(target.table)} as t
      join characters as revision on revision.id = t.${sql.identifier(target.characterColumn)}
      join ${plan} on plan.stable_key = revision.stable_key
      where not exists (
        select 1
        from character_identities as identity
        where identity.stable_key = revision.stable_key
          and identity.id = t.${sql.identifier(target.identityColumn)}
      )
    `);
    const leftNull = await scalar(sql`
      select count(*)::int as count
      from ${sql.identifier(target.table)} as t
      where t.${sql.identifier(target.identityColumn)} is null
        and not exists (
          select 1
          from characters as revision
          join ${plan} on plan.stable_key = revision.stable_key
          where revision.id = t.${sql.identifier(target.characterColumn)}
        )
    `);
    const unresolvable = await scalar(sql`
      select count(*)::int as count
      from ${sql.identifier(target.table)} as t
      where t.${sql.identifier(target.characterColumn)} is not null
        and not exists (
          select 1
          from characters as revision
          join ${plan} on plan.stable_key = revision.stable_key
          where revision.id = t.${sql.identifier(target.characterColumn)}
        )
    `);
    reports.push({ target, toSet, leftNull, unresolvable });
  }

  console.log("\nidentity_id backfill (rows to set / rows left null afterwards):");
  for (const report of reports) {
    const column = `${report.target.table}.${report.target.identityColumn}`;
    console.log(`  ${column}: ${report.toSet} to set, ${report.leftNull} left null (${report.target.reason})`);
  }
  console.log(`  version content kept on the revision row: ${versionContentTables.join(", ")}`);

  const totalToSet = reports.reduce((sum, report) => sum + report.toSet, 0);
  const totalLeftNull = reports.reduce((sum, report) => sum + report.leftNull, 0);
  const totalUnresolvable = reports.reduce((sum, report) => sum + report.unresolvable, 0);
  console.log(`\ntotal: ${toCreate.length} identities to create, ${totalToSet} user-state rows to update, ${totalLeftNull} rows left null`);

  if (totalUnresolvable > 0) {
    console.log(`warning: ${totalUnresolvable} rows point at a revision whose stable_key is not in characters; they keep identity_id null.`);
  }

  if (!apply) {
    console.log("\ndry run: nothing written. Re-run with --apply to create these identities and set identity_id in one transaction.");
    process.exit(0);
  }

  await database.transaction(async (transaction) => {
    if (toCreate.length > 0) {
      const created = rowsOf(await transaction.execute(sql`
        insert into character_identities (stable_key, current_character_id)
        values ${sql.join(
          toCreate.map((row) => sql`(${row.stableKey}, ${row.currentCharacterId})`),
          sql`, `,
        )}
        on conflict (stable_key) do nothing
        returning stable_key
      `));
      if (created.length !== toCreate.length) {
        throw new Error(`created ${created.length} identities but the dry run planned ${toCreate.length}.`);
      }
      console.log(`created ${created.length} identities`);
    }

    for (const report of reports) {
      const updated = rowsOf(await transaction.execute(sql`
        update ${sql.identifier(report.target.table)} as t
        set ${sql.identifier(report.target.identityColumn)} = identity.id
        from characters as revision
        join character_identities as identity on identity.stable_key = revision.stable_key
        where t.${sql.identifier(report.target.characterColumn)} = revision.id
          and t.${sql.identifier(report.target.identityColumn)} is distinct from identity.id
        returning 1 as updated
      `));
      if (updated.length !== report.toSet) {
        throw new Error(`${report.target.table}.${report.target.identityColumn}: updated ${updated.length} rows but the dry run counted ${report.toSet}.`);
      }
      console.log(`set ${updated.length} rows in ${report.target.table}.${report.target.identityColumn}`);
    }
  });

  console.log("\napplied. Re-run without --apply to confirm zero identities to create and zero rows to update.");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "character identity backfill failed");
  process.exitCode = 1;
});
