// @vitest-environment node
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { importMediaSeriesManifest, inspectMediaSeriesManifest, type MediaSeriesImportTransaction } from "@/src/modules/media/application/import-media-series";
import type { SaveMediaSeriesCommand } from "@/src/modules/media/domain/media-series";
import { createDrizzleMediaSeriesRepository } from "@/src/modules/media/repositories/drizzle-media-series-repository";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const owner = "00000000-0000-4000-8000-0000000000a1";
const previousAllowlist = process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
function command(stableKey: string, overrides: Partial<SaveMediaSeriesCommand> = {}): SaveMediaSeriesCommand {
  return { idempotencyKey: `import-${stableKey}`, expectedRevision: 0, title: "Fixture programme", summary: "", kind: "video", orderMode: "ordered", status: "active", reason: "Official catalogue", evidence: ["https://fixture.test/programme"], members: [{ stableKey, position: 1, seasonNumber: null, episodeNumber: null, episodeLabel: null, evidence: ["official-order"] }], removeStableKeys: [], fromSeriesRevisions: {}, ...overrides };
}
function source(entries: { seriesKey: string; command: SaveMediaSeriesCommand }[]) { return JSON.stringify({ schemaVersion: 1, catalogueKey: "catalogue.database-fixture", entries }); }

describe("atomic media series manifest import", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let transaction: MediaSeriesImportTransaction;
  beforeAll(async () => {
    process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = owner;
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to anon, authenticated;");
    for (const name of ["0000_big_phalanx", "0024_media_library_foundation", "0025_youtube_video_publication", "0026_brief_toro", "0027_pale_colossus", "0041_media_cefr_four_levels", "0046_media_series_directory"]) await client.exec((await readFile(`drizzle/${name}.sql`, "utf8")).replaceAll("--> statement-breakpoint", ""));
    db = drizzle(client, { schema });
    for (const stableKey of ["import.one", "import.two", "import.three"]) await db.insert(schema.mediaItems).values({ stableKey, kind: "video", currentVersion: 1 });
    transaction = (operation) => db.transaction((tx) => operation(createDrizzleMediaSeriesRepository(tx as unknown as Database)));
  }, 30_000);
  afterAll(async () => {
    if (previousAllowlist === undefined) delete process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
    else process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = previousAllowlist;
    await client?.close();
  });

  const run = (raw: string, mode: "dry-run" | "apply" = "dry-run") => importMediaSeriesManifest({ source: raw, mode, ownerUserId: owner, expectedSha256: inspectMediaSeriesManifest(raw).sha256 }, { transaction });
  async function counts() {
    return { series: (await db.select().from(schema.mediaSeries)).length, members: (await db.select().from(schema.mediaSeriesMemberships)).length, audits: (await db.select().from(schema.mediaSeriesChanges)).length };
  }
  it("rehearses the actual writes and rolls back all series, memberships and audits", async () => {
    const raw = source([{ seriesKey: "series.one", command: command("import.one") }, { seriesKey: "series.two", command: command("import.two") }]);
    const report = await run(raw);
    expect(report.mode).toBe("dry-run");
    expect(report.entries).toEqual([{ seriesKey: "series.one", expectedRevision: 0, resultRevision: 1 }, { seriesKey: "series.two", expectedRevision: 0, resultRevision: 1 }]);
    expect(JSON.stringify(report)).not.toContain(owner);
    expect(await counts()).toEqual({ series: 0, members: 0, audits: 0 });
  });
  it("rolls back a valid earlier series when a later media identity conflicts", async () => {
    const raw = source([{ seriesKey: "series.first", command: command("import.one") }, { seriesKey: "series.later", command: command("import.missing") }]);
    for (const mode of ["dry-run", "apply"] as const) {
      await expect(run(raw, mode)).rejects.toMatchObject({ code: "MEDIA_SERIES_MEMBERSHIP_CONFLICT" });
      expect(await counts()).toEqual({ series: 0, members: 0, audits: 0 });
    }
  });
  it("applies atomically, replays without duplicate audits, and rejects changed payloads", async () => {
    const entries = [{ seriesKey: "series.one", command: command("import.one") }, { seriesKey: "series.two", command: command("import.two") }];
    const raw = source(entries);
    const first = await run(raw, "apply");
    expect((await run(raw, "apply")).entries).toEqual(first.entries);
    const upperCaseActorReplay = await importMediaSeriesManifest({ source: raw, mode: "apply", ownerUserId: owner.toUpperCase(), expectedSha256: first.sha256 }, { transaction });
    expect(upperCaseActorReplay).toEqual(first);
    expect(await counts()).toEqual({ series: 2, members: 2, audits: 2 });
    await expect(run(source([{ ...entries[0], command: { ...entries[0].command, title: "Changed" } }, entries[1]]), "apply")).rejects.toMatchObject({ code: "MEDIA_SERIES_IDEMPOTENCY_CONFLICT" });
    expect(await counts()).toEqual({ series: 2, members: 2, audits: 2 });
    expect((await db.select().from(schema.mediaItems)).every((item) => item.currentVersion === 1)).toBe(true);
  });
  it("rolls back a new earlier series when a later existing series has a revision conflict", async () => {
    const raw = source([{ seriesKey: "series.three", command: command("import.three") }, { seriesKey: "series.two", command: command("import.two", { idempotencyKey: "new-stale-command" }) }]);
    await expect(run(raw, "apply")).rejects.toMatchObject({ code: "MEDIA_SERIES_REVISION_CONFLICT" });
    expect(await counts()).toEqual({ series: 2, members: 2, audits: 2 });
  });
});
