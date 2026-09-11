// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  completeScenarioRepetition,
  completeScenarioSession,
  createDrizzleScenarioPracticeRepository,
  getScenarioSessionReview,
  listDueScenarioRepetitions,
  listScenarioHistory,
  submitScenarioTurn,
} from "@/src/modules/scenario-practice";
import * as schema from "@/src/shared/db/schema";

const userId = "00000000-0000-4000-8000-000000000401";
const sessionId = "10000000-0000-4000-8000-000000000401";
const scenarioId = "20000000-0000-4000-8000-000000000401";
const turnId = "30000000-0000-4000-8000-000000000401";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
}

describe("scenario review transaction", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(`
      create role anon nologin; create role authenticated nologin; create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    `);
    for (const name of ["0000_big_phalanx.sql", "0001_auth_rls.sql", "0020_volatile_eternity.sql"]) await client.exec(await migration(name));
    database = drizzle(client, { schema });
    await client.exec(`insert into auth.users (id, email) values ('${userId}', 'review@example.test');`);
    await database.insert(schema.scenarios).values({ id: scenarioId, stableKey: "scenario.review.transaction", title: { "zh-CN": "校园办事" }, description: { "zh-CN": "测试" }, setting: "campus", relationshipType: "service", cefrLevel: "A2", status: "published" });
  });

  afterEach(async () => client.close());

  it("freezes history, creates pending reviews and exposes the 0/1/3/7 schedule", async () => {
    const repository = createDrizzleScenarioPracticeRepository(database);
    await repository.createSession({ sessionId, userId, scenarioId, clientAttemptId: "session-401", primaryModality: "speech", contentVersion: 1, communicationGoal: "说明需求并确认材料", temporaryCharacter: { displayName: "Javier", role: "办事员", locale: "es-ES" } });
    await submitScenarioTurn(repository, { id: turnId, userId, sessionId, clientAttemptId: "turn-401", turnIndex: 0, speaker: "user", modality: "speech", text: "Necesito renovar mi tarjeta.", attemptId: turnId, generationId: "generation-401" });

    await completeScenarioSession(repository, { userId, sessionId, expectedRevision: 1, idempotencyKey: "complete-401", expressionSnapshot: ["Necesito renovar mi tarjeta."], goalSnapshot: "说明需求并确认材料", variantRequirements: [{ kind: "condition" }], now: () => new Date("2026-09-11T08:00:00.000Z"), makeRepetitionId: (step) => `40000000-0000-4000-8000-00000000040${step}` });

    const history = await listScenarioHistory(repository, userId);
    expect(history[0]).toMatchObject({ sessionId, scenarioKey: "scenario.review.transaction", title: "校园办事", userTurnCount: 1 });
    const review = await getScenarioSessionReview(repository, userId, sessionId);
    expect(review.turns[0]).toMatchObject({ id: turnId, review: { status: "pending", communicationSuccess: null } });
    expect(review.repetitions.map((item) => item.intervalDays)).toEqual([0, 1, 3, 7]);
    await expect(listDueScenarioRepetitions(repository, userId, () => new Date("2026-09-11T08:00:00.000Z"))).resolves.toHaveLength(1);

    const firstReview = await repository.saveTurnReview({ id: "50000000-0000-4000-8000-000000000401", userId, turnId, communicationSuccess: false, errorSpans: [{ explanation: "需要补充材料名称。" }], naturalAlternatives: ["Necesito renovar la tarjeta de estudiante."], hintLevel: 0, transcriptConfidence: 0.9, algorithmVersion: "scenario-evaluation-v1", providerKey: "fake", modelVersion: "fake-v1", providerRequestId: "request-1", status: "ready" });
    const repeatedReview = await repository.saveTurnReview({ id: "50000000-0000-4000-8000-000000000402", userId, turnId, communicationSuccess: true, errorSpans: [], naturalAlternatives: ["A replacement that must not overwrite history."], hintLevel: 0, transcriptConfidence: 0.95, algorithmVersion: "scenario-evaluation-v1", providerKey: "fake", modelVersion: "fake-v1", providerRequestId: "request-2", status: "ready" });
    expect(repeatedReview).toEqual(firstReview);

    const completed = await completeScenarioRepetition(repository, { userId, repetitionId: review.repetitions[0]!.id, completionKey: "repeat-401", result: "needs-work", now: () => new Date("2026-09-11T09:00:00.000Z") });
    expect(completed).toMatchObject({ status: "completed", item: { result: "needs-work" } });
    await expect(completeScenarioRepetition(repository, { userId, repetitionId: review.repetitions[0]!.id, completionKey: "another-key", result: "contextual-success" })).rejects.toThrow("SCENARIO_TURN_CONFLICT");
  });
});
