// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const userA = "00000000-0000-4000-8000-00000000000a";
const userB = "00000000-0000-4000-8000-00000000000b";
const characterId = "10000000-0000-4000-8000-000000000001";
const domainId = "20000000-0000-4000-8000-000000000001";
const goalId = "30000000-0000-4000-8000-000000000001";
const publicExpressionId = "40000000-0000-4000-8000-000000000001";
const draftExpressionId = "40000000-0000-4000-8000-000000000002";

async function migration(name: string) {
  return (
    await readFile(path.join(process.cwd(), "drizzle", name), "utf8")
  ).replaceAll("--> statement-breakpoint", "");
}

async function assumeUser(database: PGlite, userId: string) {
  await database.exec(`
    set role authenticated;
    select set_config('request.jwt.claim.sub', '${userId}', false);
  `);
}

describe("Supabase RLS baseline", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (
        id uuid primary key,
        email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid()
      returns uuid
      language sql
      stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    await database.exec(await migration("0000_big_phalanx.sql"));
    await database.exec(await migration("0001_auth_rls.sql"));
    await database.exec(await migration("0002_content_import_registry.sql"));
    await database.exec(await migration("0003_chunky_black_knight.sql"));

    await database.exec(`
      insert into auth.users (id, email)
      values
        ('${userA}', 'a@example.test'),
        ('${userB}', 'b@example.test');

      insert into characters (
        id, stable_key, display_name, home_location, profile,
        character_version, status
      ) values (
        '${characterId}', 'lucia', 'Lucía', 'Madrid', '{}'::jsonb,
        1, 'draft'
      );

      insert into conversations (user_id, character_id)
      values
        ('${userA}', '${characterId}'),
        ('${userB}', '${characterId}');

      insert into evidence_events (
        user_id, idempotency_key, source_type, skill_key, modality,
        outcome_score, evidence_weight, confidence, content_version,
        algorithm_version
      ) values
        ('${userA}', 'evidence-a', 'practice', 'conversation.start', 'speech', 0.8, 0.7, 0.9, 1, 'v1'),
        ('${userB}', 'evidence-b', 'practice', 'conversation.start', 'speech', 0.7, 0.7, 0.9, 1, 'v1');

      insert into communication_domains (
        id, stable_key, title, description, status
      ) values (
        '${domainId}', 'start-conversation', '{"zh-CN":"开始交流"}', '{}', 'draft'
      );

      insert into learning_goals (
        id, domain_id, stable_key, title, description, status
      ) values (
        '${goalId}', '${domainId}', 'greet-naturally', '{"zh-CN":"自然问候"}', '{}', 'draft'
      );

      insert into expressions (
        id, goal_id, stable_key, source_text, translations,
        communicative_intent, cefr_level, content_version, status
      ) values
        ('${publicExpressionId}', '${goalId}', 'hola-que-tal', 'Hola, ¿qué tal?', '{}', '{}', 'A1', 1, 'published'),
        ('${draftExpressionId}', '${goalId}', 'draft-expression', 'Borrador', '{}', '{}', 'A1', 1, 'draft');

      insert into content_reviews (
        entity_type, entity_id, locale, status
      ) values (
        'expression', '${publicExpressionId}', 'es-ES', 'approved'
      );
    `);
  });

  afterEach(async () => {
    await database.close();
  });

  it("creates profile and preferences from the auth user lifecycle", async () => {
    const profiles = await database.query<{ id: string }>(
      "select id from profiles order by id",
    );
    const preferences = await database.query<{ user_id: string }>(
      "select user_id from user_preferences order by user_id",
    );

    expect(profiles.rows.map((row) => row.id)).toEqual([userA, userB]);
    expect(preferences.rows.map((row) => row.user_id)).toEqual([userA, userB]);
  });

  it("prevents user A from reading user B evidence and conversations", async () => {
    await assumeUser(database, userA);

    const evidence = await database.query<{ user_id: string }>(
      "select user_id from evidence_events",
    );
    const conversations = await database.query<{ user_id: string }>(
      "select user_id from conversations",
    );

    expect(evidence.rows.map((row) => row.user_id)).toEqual([userA]);
    expect(conversations.rows.map((row) => row.user_id)).toEqual([userA]);
  });

  it("does not allow authenticated clients to mutate evidence history", async () => {
    await assumeUser(database, userA);

    await expect(
      database.exec(
        "update evidence_events set outcome_score = 0 where user_id = current_setting('request.jwt.claim.sub')::uuid",
      ),
    ).rejects.toThrow();
  });

  it("does not grant clients writes to derived, memory, or provider facts", async () => {
    const privileges = await database.query<{
      skill_insert: boolean;
      memory_insert: boolean;
      provider_insert: boolean;
    }>(`
      select
        has_table_privilege('authenticated', 'public.user_skill_states', 'INSERT') as skill_insert,
        has_table_privilege('authenticated', 'public.relationship_memories', 'INSERT') as memory_insert,
        has_table_privilege('authenticated', 'public.provider_calls', 'INSERT') as provider_insert
    `);

    expect(privileges.rows[0]).toEqual({
      skill_insert: false,
      memory_insert: false,
      provider_insert: false,
    });
  });

  it("keeps import hashes and editorial source evidence server-only", async () => {
    const privileges = await database.query<{
      import_select: boolean;
      import_insert: boolean;
      public_source_column: boolean;
      private_source_column: boolean;
    }>(`
      select
        has_table_privilege('authenticated', 'public.content_bundle_imports', 'SELECT') as import_select,
        has_table_privilege('authenticated', 'public.content_bundle_imports', 'INSERT') as import_insert,
        has_column_privilege('anon', 'public.content_sources', 'copyright_status', 'SELECT') as public_source_column,
        has_column_privilege('anon', 'public.content_sources', 'license_evidence', 'SELECT') as private_source_column
    `);

    expect(privileges.rows[0]).toEqual({
      import_select: false,
      import_insert: false,
      public_source_column: true,
      private_source_column: false,
    });
  });

  it("prevents user A from updating user B profile or preferences", async () => {
    await assumeUser(database, userA);

    await database.exec(`
      update profiles set display_name = 'not allowed' where id = '${userB}';
      update user_preferences set correction_mode = 'strict' where user_id = '${userB}';
    `);

    await database.exec("reset role");
    const profile = await database.query<{ display_name: string | null }>(
      `select display_name from profiles where id = '${userB}'`,
    );
    const preferences = await database.query<{ correction_mode: string }>(
      `select correction_mode from user_preferences where user_id = '${userB}'`,
    );

    expect(profile.rows[0]?.display_name).toBeNull();
    expect(preferences.rows[0]?.correction_mode).toBe("balanced");
  });

  it("only exposes published and approved expressions", async () => {
    await database.exec("set role anon");
    const expressions = await database.query<{ id: string }>(
      "select id from expressions order by id",
    );

    expect(expressions.rows.map((row) => row.id)).toEqual([
      publicExpressionId,
    ]);
  });
});
