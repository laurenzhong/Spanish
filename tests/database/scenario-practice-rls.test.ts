// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const userA = "00000000-0000-4000-8000-000000000211";
const userB = "00000000-0000-4000-8000-000000000212";
const scenario = "10000000-0000-4000-8000-000000000211";
const sessionA = "20000000-0000-4000-8000-000000000211";
const sessionB = "20000000-0000-4000-8000-000000000212";
const personalA = "30000000-0000-4000-8000-000000000211";
const personalB = "30000000-0000-4000-8000-000000000212";
const turnA = "40000000-0000-4000-8000-000000000211";
const turnB = "40000000-0000-4000-8000-000000000212";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

describe("scenario practice RLS", () => {
  let client: PGlite;

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
    for (const name of ["0000_big_phalanx.sql", "0001_auth_rls.sql", "0020_volatile_eternity.sql"]) {
      await client.exec(await migration(name));
    }
    await client.exec(`
      insert into auth.users (id, email) values ('${userA}', 'a@example.test'), ('${userB}', 'b@example.test');
      insert into scenarios (id, stable_key, title, description, setting, relationship_type, cefr_level, status)
      values ('${scenario}', 'restaurant.rls', '{}', '{}', 'restaurant', 'service', 'A2', 'published');
      insert into practice_sessions (id, user_id, scenario_id, primary_modality, content_version)
      values
        ('${sessionA}', '${userA}', '${scenario}', 'typing', 1),
        ('${sessionB}', '${userB}', '${scenario}', 'typing', 1);
      insert into user_saved_expressions (user_id, client_save_id, source_text, source_type)
      values ('${userA}', 'save-a', 'Quisiera la sopa.', 'manual'), ('${userB}', 'save-b', 'Quisiera el menú.', 'manual');
      insert into personal_scenarios (id, user_id, idempotency_key, title, cefr, region, skeleton, source_type, provider_key, model_version, generation_version)
      values
        ('${personalA}', '${userA}', 'personal-a', 'A', 'A2', 'es-ES', '{}', 'topic', 'fake', 'fake-v1', 'v1'),
        ('${personalB}', '${userB}', 'personal-b', 'B', 'A2', 'es-ES', '{}', 'topic', 'fake', 'fake-v1', 'v1');
      insert into scenario_session_states (session_id, user_id, personal_scenario_id, client_attempt_id, temporary_character, communication_goal)
      values
        ('${sessionA}', '${userA}', '${personalA}', 'session-a', '{"displayName":"A","role":"server","locale":"es-ES"}', 'Order'),
        ('${sessionB}', '${userB}', '${personalB}', 'session-b', '{"displayName":"B","role":"server","locale":"es-ES"}', 'Order');
      insert into scenario_turns (id, user_id, session_id, client_attempt_id, turn_index, speaker, modality, text, status, completed_at)
      values
        ('${turnA}', '${userA}', '${sessionA}', 'turn-a', 0, 'user', 'typing', 'Hola A', 'completed', now()),
        ('${turnB}', '${userB}', '${sessionB}', 'turn-b', 0, 'user', 'typing', 'Hola B', 'completed', now());
      insert into scenario_turn_reviews (user_id, turn_id, algorithm_version, status)
      values ('${userA}', '${turnA}', 'v1', 'ready'), ('${userB}', '${turnB}', 'v1', 'ready');
      insert into scenario_repetition_items (user_id, source_session_id, personal_scenario_id, goal_snapshot, due_at, interval_step, idempotency_key)
      values
        ('${userA}', '${sessionA}', '${personalA}', 'Order', now(), 0, 'repeat-a'),
        ('${userB}', '${sessionB}', '${personalB}', 'Order', now(), 0, 'repeat-b');
      insert into user_provider_preferences (user_id, capability, provider_key)
      values ('${userA}', 'scenario-roleplay', 'fake-a'), ('${userB}', 'scenario-roleplay', 'fake-b');
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${userA}', false);
    `);
  });

  afterEach(async () => {
    await client.close();
  });

  it("shows only the current user's rows in every private scenario table", async () => {
    for (const table of [
      "user_saved_expressions",
      "personal_scenarios",
      "scenario_session_states",
      "scenario_turns",
      "scenario_turn_reviews",
      "scenario_repetition_items",
      "user_provider_preferences",
    ]) {
      const own = await client.query<{ user_id: string }>(`select user_id from ${table}`);
      expect(own.rows, table).toEqual([{ user_id: userA }]);
      const hidden = await client.query<{ user_id: string }>(`select user_id from ${table} where user_id = '${userB}'`);
      expect(hidden.rows, table).toEqual([]);
      const modified = await client.query<{ user_id: string }>(
        `update ${table} set updated_at = now() where user_id = '${userB}' returning user_id`,
      );
      expect(modified.rows, table).toEqual([]);
    }
  });

  it("rejects cross-user writes and cross-owned parent references", async () => {
    await expect(client.exec(`
      insert into user_provider_preferences (user_id, capability, provider_key)
      values ('${userB}', 'scenario-evaluation', 'attacker');
    `)).rejects.toThrow();
    await expect(client.exec(`
      insert into scenario_turns (user_id, session_id, client_attempt_id, turn_index, speaker, modality, text, status, completed_at)
      values ('${userA}', '${sessionB}', 'cross-parent', 1, 'user', 'typing', 'attack', 'completed', now());
    `)).rejects.toThrow();
    await expect(client.exec(`
      insert into scenario_turn_reviews (user_id, turn_id, algorithm_version)
      values ('${userA}', '${turnB}', 'v1');
    `)).rejects.toThrow();
  });
});
