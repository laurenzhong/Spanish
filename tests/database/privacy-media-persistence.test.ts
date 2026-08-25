// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDrizzlePrivacyRepository } from "@/src/modules/privacy";
import * as schema from "@/src/shared/db/schema";

const userA = "00000000-0000-4000-0000-000000000081";
const userB = "00000000-0000-4000-0000-000000000082";
const sessionA = "00000000-0000-4000-0000-000000000083";
const sessionB = "00000000-0000-4000-0000-000000000084";
const attemptA = "00000000-0000-4000-0000-000000000085";
const attemptB = "00000000-0000-4000-0000-000000000086";
const audioSaved = "00000000-0000-4000-0000-000000000087";
const audioEphemeral = "00000000-0000-4000-0000-000000000088";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

describe("privacy media persistence", () => {
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
    for (const name of ["0000_big_phalanx.sql", "0001_auth_rls.sql", "0002_content_import_registry.sql"]) {
      await client.exec(await migration(name));
    }
    database = drizzle(client, { schema });
    await client.exec(`insert into auth.users (id, email) values ('${userA}', 'media-a@example.test'), ('${userB}', 'media-b@example.test');`);
    await database.insert(schema.practiceSessions).values([
      { id: sessionA, userId: userA, primaryModality: "speech", contentVersion: 1 },
      { id: sessionB, userId: userB, primaryModality: "speech", contentVersion: 1 },
    ]);
    await database.insert(schema.practiceAttempts).values([
      { id: attemptA, userId: userA, sessionId: sessionA, clientAttemptId: "media-a", modality: "speech", responseText: "¿Cómo va todo?", contentVersion: 1, algorithmVersion: "training-v1" },
      { id: attemptB, userId: userB, sessionId: sessionB, clientAttemptId: "media-b", modality: "speech", responseText: "Estoy bien.", contentVersion: 1, algorithmVersion: "training-v1" },
    ]);
    await database.insert(schema.audioAssets).values([
      { id: audioSaved, userId: userA, storageBucket: "milestones", storagePath: "user-a/saved.webm", purpose: "milestone", mimeType: "audio/webm", sizeBytes: 1024, durationMs: 2400, retentionPolicy: "milestone" },
      { id: audioEphemeral, userId: userA, storageBucket: "temporary", storagePath: "user-a/temp.webm", purpose: "practice", mimeType: "audio/webm", sizeBytes: 512, durationMs: 1200, retentionPolicy: "ephemeral" },
    ]);
    await database.insert(schema.evidenceEvents).values({
      userId: userA,
      practiceAttemptId: attemptA,
      idempotencyKey: "privacy-media-evidence",
      sourceType: "test",
      sourceReference: {},
      skillKey: "task.start",
      modality: "speech",
      outcomeScore: 0.8,
      evidenceWeight: 0.7,
      confidence: 0.8,
      contentVersion: 1,
      algorithmVersion: "evidence-v1",
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it("lists only owned saved audio and transcripts", async () => {
    const repository = createDrizzlePrivacyRepository(database);
    await expect(repository.listSavedAudio(userA)).resolves.toEqual([
      expect.objectContaining({ id: audioSaved, retentionPolicy: "milestone" }),
    ]);
    await expect(repository.listTranscripts(userA)).resolves.toEqual([
      expect.objectContaining({ attemptId: attemptA, text: "¿Cómo va todo?" }),
    ]);
    await expect(repository.listTranscripts(userB)).resolves.toEqual([
      expect.objectContaining({ attemptId: attemptB, text: "Estoy bien." }),
    ]);
  });

  it("deletes only owned saved data and keeps evidence tables untouched", async () => {
    const repository = createDrizzlePrivacyRepository(database);
    await expect(repository.deleteSavedAudio(userB, audioSaved)).resolves.toBe(false);
    await expect(repository.deleteSavedAudio(userA, audioSaved)).resolves.toBe(true);
    await expect(repository.deleteTranscript(userB, attemptA)).resolves.toBe(false);
    await expect(repository.deleteTranscript(userA, attemptA)).resolves.toBe(true);

    await expect(repository.listSavedAudio(userA)).resolves.toEqual([]);
    await expect(repository.listTranscripts(userA)).resolves.toEqual([]);
    const [audio] = await database.select({ deletedAt: schema.audioAssets.deletedAt }).from(schema.audioAssets).where(eq(schema.audioAssets.id, audioSaved));
    const [attempt] = await database.select({ responseText: schema.practiceAttempts.responseText }).from(schema.practiceAttempts).where(and(eq(schema.practiceAttempts.id, attemptA), eq(schema.practiceAttempts.userId, userA)));
    const evidence = await database.select({ id: schema.evidenceEvents.id }).from(schema.evidenceEvents).where(eq(schema.evidenceEvents.practiceAttemptId, attemptA));
    expect(audio?.deletedAt).toBeInstanceOf(Date);
    expect(attempt?.responseText).toBeNull();
    expect(evidence).toHaveLength(1);
  });
});
