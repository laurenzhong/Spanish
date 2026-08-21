// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { recordEvidence } from "@/src/modules/evidence";
import { createDrizzleEvidenceRepository } from "@/src/modules/evidence/repositories";
import * as schema from "@/src/shared/db/schema";

const userId = "00000000-0000-4000-8000-000000000021";
const sessionId = "00000000-0000-4000-8000-000000000022";
const attemptId = "00000000-0000-4000-8000-000000000023";

async function migration(name: string) {
  return (
    await readFile(path.join(process.cwd(), "drizzle", name), "utf8")
  ).replaceAll("--> statement-breakpoint", "");
}

async function createTestDatabase() {
  const client = new PGlite();
  await client.exec(`
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
  for (const name of [
    "0000_big_phalanx.sql",
    "0001_auth_rls.sql",
    "0002_content_import_registry.sql",
  ]) {
    await client.exec(await migration(name));
  }

  const database = drizzle(client, { schema });
  await client.exec(`
    insert into auth.users (id, email)
    values ('${userId}', 'alpha-012@example.test');
  `);
  await database.insert(schema.practiceSessions).values({
    id: sessionId,
    userId,
    primaryModality: "speech",
    contentVersion: 1,
  });
  await database.insert(schema.practiceAttempts).values({
    id: attemptId,
    userId,
    sessionId,
    clientAttemptId: "alpha-012-client-attempt",
    modality: "speech",
    responseText: "¿Cómo va todo?",
    transcriptConfidence: 0.96,
    contentVersion: 1,
    algorithmVersion: "training-v1",
  });
  return { client, database };
}

function evaluationInput() {
  return {
    algorithmVersion: "evidence-v1",
    contentVersion: 1,
    contextualSuccess: true,
    evaluationConfidence: 0.95,
    evidenceStrength: "strong",
    hasUsableTranscript: true,
    hintLevel: 0,
    idempotencyKey: "alpha-012-attempt",
    modality: "speech",
    occurredAt: new Date("2026-08-21T12:00:00.000Z"),
    practiceAttemptId: attemptId,
    skillObservations: [
      { isTargetSkill: false, skillKey: "task.start", tagWeight: 0.8 },
    ],
    targetExpressionUsed: true,
    taskDifficulty: 0.8,
    technicalFailure: false,
    transcriptConfidence: 0.96,
    userId,
  };
}

describe("recordEvidence database integration", () => {
  let client: PGlite;
  let database: Awaited<ReturnType<typeof createTestDatabase>>["database"];

  beforeEach(async () => {
    ({ client, database } = await createTestDatabase());
  });

  afterEach(async () => {
    await client.close();
  });

  it("appends evidence and rebuilds the user skill snapshot transactionally", async () => {
    const repository = createDrizzleEvidenceRepository(database);

    const result = await recordEvidence(repository, evaluationInput());

    expect(result.status).toBe("recorded");
    const [event] = await database
      .select()
      .from(schema.evidenceEvents)
      .where(
        and(
          eq(schema.evidenceEvents.userId, userId),
          eq(schema.evidenceEvents.skillKey, "task.start"),
        ),
      );
    const [state] = await database
      .select()
      .from(schema.userSkillStates)
      .where(
        and(
          eq(schema.userSkillStates.userId, userId),
          eq(schema.userSkillStates.skillKey, "task.start"),
        ),
      );

    expect(event).toMatchObject({
      algorithmVersion: "evidence-v1",
      modality: "speech",
      outcomeScore: 1,
      practiceAttemptId: attemptId,
      userId,
    });
    expect(state).toMatchObject({
      evidenceCount: 1,
      skillKey: "task.start",
      userId,
    });
    expect(state?.mastery).toBeGreaterThan(0);
    expect(state?.confidence).toBeGreaterThan(0);
  });

  it("does not duplicate evidence or advance the snapshot on retry", async () => {
    const repository = createDrizzleEvidenceRepository(database);

    await recordEvidence(repository, evaluationInput());
    const retry = await recordEvidence(repository, evaluationInput());
    const [{ count }] = await database
      .select({ count: sql<number>`count(*)` })
      .from(schema.evidenceEvents)
      .where(eq(schema.evidenceEvents.userId, userId));

    expect(retry.status).toBe("duplicate");
    expect(Number(count)).toBe(1);
    expect(retry.skillStates[0]?.evidenceCount).toBe(1);
  });
});
