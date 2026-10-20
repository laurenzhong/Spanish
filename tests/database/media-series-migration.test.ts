// @vitest-environment node
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const actor = "00000000-0000-4000-8000-0000000000a1";
const migrationName = "0046_media_series_directory";

describe("media series directory migration", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;");
    for (const name of ["0000_big_phalanx", "0024_media_library_foundation", "0025_youtube_video_publication", "0026_brief_toro", "0027_pale_colossus", "0041_media_cefr_four_levels", migrationName]) {
      await database.exec((await readFile(`drizzle/${name}.sql`, "utf8")).replaceAll("--> statement-breakpoint", ""));
    }
  }, 30_000);

  afterAll(async () => { await database?.close(); });

  async function series(key: string, orderMode = "ordered", kind = "video") {
    const result = await database.query<{ id: string }>("insert into media_series (series_key, title, kind, order_mode) values ($1, $1, $2, $3) returning id", [key, kind, orderMode]);
    return result.rows[0]!.id;
  }

  async function item(key: string, kind = "video") {
    const result = await database.query<{ id: string }>("insert into media_items (stable_key, kind, current_version) values ($1, $2, 1) returning id", [key, kind]);
    return result.rows[0]!.id;
  }

  function membership(seriesId: string, mediaItemId: string, position: number | null) {
    return database.query("insert into media_series_memberships (series_id, media_item_id, position, evidence, confirmed_by) values ($1, $2, $3, '[\"https://fixture.test/official-series\"]', $4)", [seriesId, mediaItemId, position, actor]);
  }

  it("registers the migration and a complete generated snapshot", async () => {
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.find((entry) => entry.tag === migrationName)?.idx).toBe(46);
    const snapshot = JSON.parse(await readFile("drizzle/meta/0046_snapshot.json", "utf8")) as { tables: Record<string, unknown> };
    for (const name of ["media_series", "media_series_memberships", "media_series_changes"]) expect(snapshot.tables[`public.${name}`]).toBeDefined();
  });

  it("enforces one series per item, positive unique positions and matching media kinds", async () => {
    const first = await series("constraints-first");
    const second = await series("constraints-second");
    const a = await item("constraints-a");
    const b = await item("constraints-b");
    const podcast = await item("constraints-podcast", "podcast");
    await membership(first, a, 1);
    await expect(membership(second, a, 2)).rejects.toThrow(/media_series_memberships_item_uidx/);
    await expect(membership(first, b, 1)).rejects.toThrow(/media_series_memberships_position_uidx/);
    await expect(membership(first, b, 0)).rejects.toThrow(/media_series_memberships_position_check/);
    await expect(membership(first, b, null)).rejects.toThrow(/ordered_position_required/);
    await expect(membership(first, podcast, 2)).rejects.toThrow(/kind_mismatch/);
    // Sparse positions are legitimate and do not claim that missing episodes exist.
    await membership(first, b, 100);
    await expect(database.query("update media_series_memberships set season_number = -1 where media_item_id = $1", [b])).rejects.toThrow(/numbers_check/);
    await expect(database.query("update media_series_memberships set episode_number = -1 where media_item_id = $1", [b])).rejects.toThrow(/numbers_check/);
    await database.query("update media_series_memberships set season_number = 0, episode_number = 0 where media_item_id = $1", [b]);
    await expect(database.query("update media_series set revision = 0 where id = $1", [first])).rejects.toThrow(/revision_check/);
    await expect(database.query("update media_series set kind = 'podcast' where id = $1", [first])).rejects.toThrow(/parent_edit_conflicts/);
    await expect(database.query("update media_items set kind = 'podcast' where id = $1", [a])).rejects.toThrow(/item_kind_edit_conflicts/);
  });

  it("allows unknown episodic positions but validates a change to ordered", async () => {
    const id = await series("episodic", "episodic");
    const a = await item("episodic-a");
    const b = await item("episodic-b");
    await membership(id, a, null);
    await membership(id, b, null);
    await expect(database.query("update media_series set order_mode = 'ordered' where id = $1", [id])).rejects.toThrow(/parent_edit_conflicts/);
    const rows = await database.query<{ season_number: number | null; episode_number: number | null }>("select season_number, episode_number from media_series_memberships where series_id = $1", [id]);
    expect(rows.rows).toEqual([{ season_number: null, episode_number: null }, { season_number: null, episode_number: null }]);
  });

  it("rolls back a batch when any membership conflicts", async () => {
    const id = await series("atomic-batch");
    const a = await item("atomic-a");
    const b = await item("atomic-b");
    await expect(database.transaction(async (tx) => {
      for (const mediaItemId of [a, b]) {
        await tx.query("insert into media_series_memberships (series_id, media_item_id, position, evidence, confirmed_by) values ($1, $2, 1, '[\"official-order\"]', $3)", [id, mediaItemId, actor]);
      }
    })).rejects.toThrow(/position_uidx/);
    expect((await database.query("select id from media_series_memberships where series_id = $1", [id])).rows).toHaveLength(0);
  });

  it("permits the owner transaction catalogue lock with membership validation", async () => {
    const id = await series("owner-lock");
    const mediaItemId = await item("owner-lock-item");
    await database.transaction(async (tx) => {
      await tx.exec("lock table media_series in share row exclusive mode");
      await tx.query("update media_series set revision = revision + 1 where id = $1", [id]);
      await tx.query("insert into media_series_memberships (series_id, media_item_id, position, evidence, confirmed_by) values ($1, $2, 1, '[\"official-order\"]', $3)", [id, mediaItemId, actor]);
    });
    expect((await database.query("select id from media_series_memberships where series_id = $1", [id])).rows).toHaveLength(1);
  });

  it("keeps audit records append-only, idempotent and independent of profile lifetime", async () => {
    const id = await series("audit");
    const a = await item("audit-a");
    // The actor need not exist in profiles, so account deletion cannot erase provenance.
    await membership(id, a, 1);
    const insert = () => database.query("insert into media_series_changes (series_id, idempotency_key, request_hash, expected_revision, actor_user_id, reason, evidence, after_state) values ($1, 'request-1', repeat('a', 64), 0, $2, 'confirmed official series', '[\"official-order\"]', '{\"revision\":1}') returning id", [id, actor]);
    await insert();
    await expect(insert()).rejects.toThrow(/idempotency_uidx/);
    await expect(database.query("update media_series_changes set reason = 'overwritten' where series_id = $1", [id])).rejects.toThrow(/append_only/);
    await expect(database.query("delete from media_series_changes where series_id = $1", [id])).rejects.toThrow(/append_only/);
    await expect(database.exec("truncate media_series_changes")).rejects.toThrow(/append_only/);
    await expect(database.query("delete from media_series where id = $1", [id])).rejects.toThrow(/foreign key constraint/);
    const rows = await database.query<{ actor_user_id: string; reason: string }>("select actor_user_id, reason from media_series_changes where series_id = $1", [id]);
    expect(rows.rows).toEqual([{ actor_user_id: actor, reason: "confirmed official series" }]);
  });

  it("denies direct directory access for anon/authenticated and enables RLS on every table", async () => {
    const names = ["media_series", "media_series_memberships", "media_series_changes"];
    const tables = await database.query<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relname = any($1::text[]) order by relname", [names]);
    expect(tables.rows).toHaveLength(3);
    expect(tables.rows.every((table) => table.relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await database.exec(`set role ${role}`);
      try {
        for (const name of names) {
          await expect(database.query(`select * from ${name}`)).rejects.toThrow(/permission denied/);
          await expect(database.query(`delete from ${name}`)).rejects.toThrow(/permission denied/);
        }
        await expect(database.exec("insert into media_series (series_key,title,kind,order_mode) values ('unauthorized','unauthorized','video','episodic')")).rejects.toThrow(/permission denied/);
      } finally {
        await database.exec("reset role");
      }
    }
    // Defence in depth: even an accidental table grant does not create an RLS policy.
    await database.exec("grant select, insert, update, delete on media_series, media_series_memberships, media_series_changes to authenticated; set role authenticated");
    try {
      for (const name of names) expect((await database.query(`select * from ${name}`)).rows).toEqual([]);
      await expect(database.exec("insert into media_series (series_key,title,kind,order_mode) values ('rls-probe','rls-probe','video','episodic')")).rejects.toThrow(/row-level security/);
      expect((await database.query("update media_series set title = 'forged' returning id")).rows).toEqual([]);
      expect((await database.query("delete from media_series returning id")).rows).toEqual([]);
    } finally {
      await database.exec("reset role; revoke all on media_series, media_series_memberships, media_series_changes from authenticated");
    }
  });
});
