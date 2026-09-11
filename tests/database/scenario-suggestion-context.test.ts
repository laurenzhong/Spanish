// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDrizzleScenarioSuggestionContextRepository } from "@/src/modules/explore/repositories";
import * as schema from "@/src/shared/db/schema";

const userA = "00000000-0000-4000-8000-000000000221";
const userB = "00000000-0000-4000-8000-000000000222";
const scenarioId = "20000000-0000-4000-8000-000000000221";
const sessionId = "10000000-0000-4000-8000-000000000221";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

describe("scenario suggestion context persistence", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;

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
    database = drizzle(client, { schema });
    await client.exec(`insert into auth.users (id, email) values ('${userA}', 'a@example.test'), ('${userB}', 'b@example.test');`);
    await database.insert(schema.scenarios).values({
      id: scenarioId,
      stableKey: "scenario.campus-context",
      title: { "zh-CN": "校园办事" },
      description: { "zh-CN": "测试" },
      setting: "campus",
      relationshipType: "service.campus",
      cefrLevel: "A2",
      status: "published",
    });
    await database.insert(schema.userSavedExpressions).values([
      { userId: userA, clientSaveId: "save-a", sourceText: "¿Me puede ayudar?", sourceType: "manual" },
      { userId: userB, clientSaveId: "save-b", sourceText: "dato privado de B", sourceType: "manual" },
    ]);
    await database.insert(schema.userSkillStates).values({ userId: userA, skillKey: "communication.need.ask-help", mastery: 0.4, confidence: 0.8, evidenceCount: 3 });
    await database.insert(schema.userSceneStates).values({ userId: userA, scenarioId, status: "learning", mastery: 0.3, confidence: 0.8, oralCoverage: 0.7, evidenceCount: 2 });
    await database.insert(schema.practiceSessions).values({ id: sessionId, userId: userA, scenarioId, primaryModality: "typing", contentVersion: 1 });
    await database.insert(schema.scenarioSessionStates).values({ sessionId, userId: userA, clientAttemptId: "context-session-a", temporaryCharacter: { displayName: "Ana", role: "staff", locale: "es-ES" }, communicationGoal: "Pedir ayuda", stableStatus: "paused" });
  });

  afterEach(async () => {
    await client.close();
  });

  it("builds recommendation signals only from the requested user's rows", async () => {
    const repository = createDrizzleScenarioSuggestionContextRepository(database);
    const contextA = await repository.getForUser(userA);
    const contextB = await repository.getForUser(userB);

    expect(contextA).toMatchObject({
      savedExpressionTexts: ["¿Me puede ayudar?"],
      reliableGapGoalKeys: ["communication.need.ask-help"],
      practicedScenarioKeys: ["scenario.campus-context"],
      practicedCategories: ["study"],
      activeScenarioKeys: ["scenario.campus-context"],
    });
    expect(contextB.savedExpressionTexts).toEqual(["dato privado de B"]);
    expect(contextB.reliableGapGoalKeys).toEqual([]);
    expect(contextB.activeScenarioKeys).toEqual([]);
  });
});
