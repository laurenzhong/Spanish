// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeScenarioGenerationProvider } from "@/src/modules/providers/scenario-generation";
import { createDrizzleScenarioLibraryRepository, generatePersonalScenario } from "@/src/modules/scenario-practice";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const userA = "00000000-0000-4000-8000-000000000921";
const userB = "00000000-0000-4000-8000-000000000922";
const savedA = "10000000-0000-4000-8000-000000000921";
const savedB = "10000000-0000-4000-8000-000000000922";

async function migration(name: string) { return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", ""); }

describe("scenario generation source ownership", () => {
  let client: PGlite;
  let repository: ReturnType<typeof createDrizzleScenarioLibraryRepository>;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    for (const name of ["0000_big_phalanx.sql", "0001_auth_rls.sql", "0020_volatile_eternity.sql"]) await client.exec(await migration(name));
    await client.exec(`
      insert into auth.users (id, email) values ('${userA}', 'a@example.test'), ('${userB}', 'b@example.test');
      insert into user_saved_expressions (id, user_id, client_save_id, source_text, translation, source_type)
      values ('${savedA}', '${userA}', 'saved-a', 'Quisiera pedir ayuda.', '我想请求帮助。', 'manual'), ('${savedB}', '${userB}', 'saved-b', 'Dato privado B.', null, 'manual');
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${userA}', false);
    `);
    repository = createDrizzleScenarioLibraryRepository(drizzle(client, { schema }) as unknown as Database);
  });

  afterEach(async () => { await client.close(); });

  it("resolves only owned sources and exposes only the owner's ready private scenarios", async () => {
    await expect(repository.resolveGenerationSource(userA, { sourceType: "saved-expression", sourceId: savedB })).resolves.toBeNull();
    const record = await generatePersonalScenario(repository, new FakeScenarioGenerationProvider(), {
      userId: userA, idempotencyKey: "generate-owned-source", requestId: "request-owned", generationId: "generation-owned", cefr: "A2", locale: "es-ES", source: { sourceType: "saved-expression", sourceId: savedA },
    }, { makeId: () => "20000000-0000-4000-8000-000000000921" });
    expect(record.detail.expressions[0]?.text).toBe("Quisiera pedir ayuda.");
    await expect(repository.getPersonalScenario(userB, record.id)).resolves.toBeNull();
    await expect(repository.listPersonalSuggestionCandidates(userA)).resolves.toEqual([expect.objectContaining({ id: record.id, title: record.detail.title })]);
  });
});
