// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDrizzleScenarioPracticeRepository,
  createRepetitionSchedule,
  completeScenarioSession,
  persistCompletedScenarioRoleplayTurn,
  submitScenarioTurn,
} from "@/src/modules/scenario-practice";
import * as schema from "@/src/shared/db/schema";

const userId = "00000000-0000-4000-8000-000000000201";
const sessionId = "10000000-0000-4000-8000-000000000201";
const scenarioId = "20000000-0000-4000-8000-000000000201";
const userTurnId = "30000000-0000-4000-8000-000000000201";
const characterTurnId = "30000000-0000-4000-8000-000000000202";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

describe("scenario practice persistence", () => {
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
    for (const name of [
      "0000_big_phalanx.sql",
      "0001_auth_rls.sql",
      "0020_volatile_eternity.sql",
    ]) {
      await client.exec(await migration(name));
    }
    database = drizzle(client, { schema });
    await client.exec(`insert into auth.users (id, email) values ('${userId}', 'scenario@example.test');`);
    await database.insert(schema.scenarios).values({
      id: scenarioId,
      stableKey: "restaurant.order.persistence",
      title: { "zh-CN": "餐厅点餐" },
      description: { "zh-CN": "测试" },
      setting: "restaurant",
      relationshipType: "service",
      cefrLevel: "A2",
      status: "published",
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it("creates sessions and complete turns idempotently while enforcing CAS revisions", async () => {
    const repository = createDrizzleScenarioPracticeRepository(database);
    const input = {
      sessionId,
      userId,
      scenarioId,
      clientAttemptId: "scenario-session-attempt-1",
      primaryModality: "typing" as const,
      contentVersion: 1,
      communicationGoal: "Pedir una comida.",
      temporaryCharacter: { displayName: "Carmen", role: "camarera", locale: "es-ES" },
    };
    const created = await repository.createSession(input);
    const repeated = await repository.createSession(input);
    expect(repeated.sessionId).toBe(created.sessionId);
    await expect(repository.createSession({
      ...input,
      communicationGoal: "A different request with the same idempotency key.",
    })).rejects.toThrow("SCENARIO_SESSION_CONFLICT");

    const advanced = await repository.compareAndSwapState({
      userId,
      sessionId,
      expectedRevision: 1,
      status: "awaiting-expression",
      hintLevel: 2,
    });
    expect(advanced.revision).toBe(2);
    await expect(repository.compareAndSwapState({
      userId,
      sessionId,
      expectedRevision: 1,
      status: "paused",
    })).rejects.toThrow("SCENARIO_SESSION_CONFLICT");

    const turnInput = {
      id: userTurnId,
      userId,
      sessionId,
      clientAttemptId: "turn-attempt-1",
      turnIndex: 0,
      speaker: "user" as const,
      modality: "typing" as const,
      text: "Quisiera la sopa, por favor.",
      attemptId: "attempt-1",
      generationId: "generation-1",
    };
    const first = await submitScenarioTurn(repository, turnInput);
    const duplicate = await submitScenarioTurn(repository, turnInput);
    expect(duplicate.turn.id).toBe(first.turn.id);
    await expect(submitScenarioTurn(repository, {
      ...turnInput,
      text: "A conflicting retry.",
    })).rejects.toThrow("SCENARIO_TURN_CONFLICT");

    const roleplayInput = {
      id: characterTurnId,
      userId,
      sessionId,
      clientAttemptId: "roleplay-generation-1",
      turnIndex: 1,
      speaker: "temporary-character" as const,
      modality: "system" as const,
      text: "Perfecto. ¿Quiere algo más?",
      generationId: "generation-1",
      replyToTurnId: userTurnId,
      done: false,
    };
    await expect(
      persistCompletedScenarioRoleplayTurn(repository, roleplayInput),
    ).rejects.toThrow("SCENARIO_REPLY_INCOMPLETE");
    const complete = await persistCompletedScenarioRoleplayTurn(repository, {
      ...roleplayInput,
      done: true,
    });
    expect(complete.status).toBe("completed");

    const [{ count }] = await database
      .select({ count: sql<number>`count(*)` })
      .from(schema.scenarioTurns)
      .where(eq(schema.scenarioTurns.userId, userId));
    expect(Number(count)).toBe(2);
  });

  it("only reviews completed user turns and creates repetition rows idempotently", async () => {
    const repository = createDrizzleScenarioPracticeRepository(database);
    await repository.createSession({
      sessionId,
      userId,
      scenarioId,
      clientAttemptId: "scenario-session-attempt-2",
      primaryModality: "speech",
      contentVersion: 1,
      communicationGoal: "Pedir una comida.",
      temporaryCharacter: { displayName: "Carmen", role: "camarera", locale: "es-ES" },
    });
    await database.insert(schema.scenarioTurns).values({
      id: userTurnId,
      userId,
      sessionId,
      clientAttemptId: "pending-turn",
      turnIndex: 0,
      speaker: "user",
      modality: "speech",
      text: "Un borrador",
      status: "pending",
    });
    await expect(database.insert(schema.scenarioTurnReviews).values({
      userId,
      turnId: userTurnId,
      algorithmVersion: "scenario-evaluation-v1",
    })).rejects.toThrow();

    await database.update(schema.scenarioTurns).set({
      status: "completed",
      completedAt: new Date("2026-09-11T00:00:00.000Z"),
    }).where(and(eq(schema.scenarioTurns.id, userTurnId), eq(schema.scenarioTurns.userId, userId)));
    await expect(database.insert(schema.scenarioTurnReviews).values({
      userId,
      turnId: userTurnId,
      algorithmVersion: "scenario-evaluation-v1",
    })).resolves.toBeDefined();

    const review = await repository.saveTurnReview({
      id: "35000000-0000-4000-8000-000000000201",
      userId,
      turnId: userTurnId,
      communicationSuccess: true,
      errorSpans: [],
      naturalAlternatives: ["Me gustaría pedir la sopa."],
      hintLevel: 1,
      transcriptConfidence: 0.82,
      algorithmVersion: "scenario-evaluation-v1",
      providerKey: "minimax",
      modelVersion: "MiniMax-M3",
      providerRequestId: "provider-request-1",
      status: "ready",
    });
    expect(review).toMatchObject({ communicationSuccess: true, status: "ready" });
    expect(await repository.listTurnReviews(userId, sessionId)).toEqual([review]);

    const schedule = createRepetitionSchedule({
      userId,
      sourceSessionId: sessionId,
      baseIdempotencyKey: "complete-session-2",
      expressionSnapshot: ["Quisiera la sopa."],
      goalSnapshot: "Pedir una comida.",
      variantRequirements: [{ kind: "character" }],
      now: () => new Date("2026-09-11T00:00:00.000Z"),
      makeId: (step) => `40000000-0000-4000-8000-00000000020${step}`,
    });
    expect(await repository.createRepetitionItems(schedule)).toBe(4);
    expect(await repository.createRepetitionItems(schedule)).toBe(0);
  });

  it("never creates long-term characters, conversations, or relationship memories", async () => {
    const repository = createDrizzleScenarioPracticeRepository(database);
    await repository.createSession({
      sessionId,
      userId,
      scenarioId,
      clientAttemptId: "scenario-session-isolation",
      primaryModality: "typing",
      contentVersion: 1,
      communicationGoal: "Pedir una comida.",
      temporaryCharacter: { displayName: "Carmen", role: "camarera", locale: "es-ES" },
    });
    for (const table of [schema.characters, schema.conversations, schema.relationshipMemories]) {
      const [{ count }] = await database.select({ count: sql<number>`count(*)` }).from(table);
      expect(Number(count)).toBe(0);
    }
  });

  it("freezes the session and creates the repetition plan atomically and idempotently", async () => {
    const repository = createDrizzleScenarioPracticeRepository(database);
    await repository.createSession({
      sessionId,
      userId,
      scenarioId,
      clientAttemptId: "scenario-session-complete",
      primaryModality: "typing",
      contentVersion: 1,
      communicationGoal: "Pedir una comida.",
      temporaryCharacter: { displayName: "Carmen", role: "camarera", locale: "es-ES" },
    });
    const completion = {
      userId,
      sessionId,
      expectedRevision: 1,
      idempotencyKey: "complete-session-idempotently",
      expressionSnapshot: ["Quisiera la sopa."],
      goalSnapshot: "Pedir una comida.",
      variantRequirements: [{ kind: "character" }],
      now: () => new Date("2026-09-11T03:00:00.000Z"),
      makeRepetitionId: (step: 0 | 1 | 2 | 3) => `50000000-0000-4000-8000-00000000020${step}`,
    } as const;

    const first = await completeScenarioSession(repository, completion);
    const repeated = await completeScenarioSession(repository, completion);
    expect(first.session).toMatchObject({ status: "completed", reviewStatus: "pending", revision: 2 });
    expect(repeated.session).toEqual(first.session);
    const [{ count }] = await database.select({ count: sql<number>`count(*)` }).from(schema.scenarioRepetitionItems);
    expect(Number(count)).toBe(4);
    await expect(completeScenarioSession(repository, {
      ...completion,
      idempotencyKey: "different-completion",
    })).rejects.toThrow("SCENARIO_SESSION_CONFLICT");
  });

  it("cascades all private scenario rows when the account profile is deleted", async () => {
    const repository = createDrizzleScenarioPracticeRepository(database);
    await repository.createSession({
      sessionId,
      userId,
      scenarioId,
      clientAttemptId: "scenario-session-delete",
      primaryModality: "typing",
      contentVersion: 1,
      communicationGoal: "Pedir una comida.",
      temporaryCharacter: { displayName: "Carmen", role: "camarera", locale: "es-ES" },
    });
    await database.insert(schema.userSavedExpressions).values({
      userId,
      clientSaveId: "save-delete",
      sourceText: "Quisiera la sopa.",
      sourceType: "manual",
    });
    await database.insert(schema.userProviderPreferences).values({
      userId,
      capability: "scenario-roleplay",
      providerKey: "fake-primary",
    });

    await database.delete(schema.profiles).where(eq(schema.profiles.id, userId));
    for (const table of [
      schema.userSavedExpressions,
      schema.scenarioSessionStates,
      schema.scenarioTurns,
      schema.scenarioTurnReviews,
      schema.scenarioRepetitionItems,
      schema.userProviderPreferences,
    ]) {
      const [{ count }] = await database.select({ count: sql<number>`count(*)` }).from(table);
      expect(Number(count)).toBe(0);
    }
  });
});
