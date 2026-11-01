// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deleteAccountData,
  deleteLuciaData,
  createDrizzlePrivacyRepository,
  type StorageObjectDeleter,
} from "@/src/modules/privacy";
import * as schema from "@/src/shared/db/schema";

const userA = "00000000-0000-4000-0000-000000000091";
const userB = "00000000-0000-4000-0000-000000000092";
const characterId = "10000000-0000-4000-0000-000000000091";
const identityId = "15000000-0000-4000-0000-000000000091";
const sessionA = "20000000-0000-4000-0000-000000000091";
const attemptA = "30000000-0000-4000-0000-000000000091";
const conversationA = "40000000-0000-4000-0000-000000000091";
const memoryA = "50000000-0000-4000-0000-000000000091";
const audioA = "60000000-0000-4000-0000-000000000091";
const messageUserA = "70000000-0000-4000-0000-000000000091";
const messageCharacterA = "70000000-0000-4000-0000-000000000092";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

const storageDeleter: StorageObjectDeleter = {
  async delete(tasks) {
    expect(tasks).toEqual([
      expect.objectContaining({
        storageBucket: "milestones",
        storagePath: "user-a/milestone.webm",
      }),
    ]);
    return { deferred: false };
  },
};

describe("account data deletion", () => {
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
      "0002_content_import_registry.sql",
      "0003_chunky_black_knight.sql",
      "0004_calm_iron_monger.sql",
      "0005_kind_character_network.sql",
      "0006_opposite_centennial.sql",
      "0007_spicy_talkback.sql",
      "0008_broad_chronomancer.sql",
      "0009_oval_namora.sql",
      "0010_watery_ogun.sql",
      "0011_*.sql",
      "0012_*.sql",
      "0013_*.sql",
      "0014_*.sql",
      "0015_flaky_havok.sql",
      "0016_proactive_messages.sql",
      "0017_sudden_betty_brant.sql",
      "0018_dusty_sue_storm.sql",
      "0040_happy_wolverine.sql",
      "0045_lumpy_medusa.sql",
      // The profile schema now includes role/account_status/deletion_requested_at
      // (ACCT-ADMIN-001); apply 0048 so the shared Drizzle profile shape matches
      // the test database.
      "0048_account_access_and_admin_console.sql",
      "0050_parched_nextwave.sql",
      "0051_learning_insight_reports.sql",
      "0052_user_vocabulary_marks.sql",
      "0053_vocabulary_mark_import_boundary.sql",
      "0054_vocabulary_recall_progress.sql",
    ]) {
      const migrationName = name.includes("*")
        ? (await readdir(path.join(process.cwd(), "drizzle"))).find((file) => new RegExp(`^${name.replace("*", ".*")}$`, "u").test(file))
        : name;
      if (migrationName) await client.exec(await migration(migrationName));
    }
    database = drizzle(client, { schema });
    await client.exec(`
      insert into auth.users (id, email) values
        ('${userA}', 'delete-a@example.test'),
        ('${userB}', 'delete-b@example.test');
    `);
    await database.insert(schema.characters).values({
      id: characterId,
      stableKey: "lucia",
      displayName: "Lucía",
      homeLocation: "Madrid",
      profile: {},
    });
    // All of this user's Lucía state is keyed by the identity; the deletion is
    // scoped by it rather than by a set of revision ids.
    await database.insert(schema.characterIdentities).values({
      id: identityId,
      stableKey: "lucia",
      currentCharacterId: characterId,
    });
    await database.insert(schema.practiceSessions).values({
      id: sessionA,
      userId: userA,
      primaryModality: "speech",
      contentVersion: 1,
    });
    await database.insert(schema.practiceAttempts).values({
      id: attemptA,
      userId: userA,
      sessionId: sessionA,
      clientAttemptId: "delete-attempt",
      modality: "speech",
      responseText: "Tengo una reserva.",
      contentVersion: 1,
      algorithmVersion: "training-v1",
    });
    await database.insert(schema.audioAssets).values({
      id: audioA,
      userId: userA,
      storageBucket: "milestones",
      storagePath: "user-a/milestone.webm",
      purpose: "milestone",
      mimeType: "audio/webm",
      sizeBytes: 100,
      retentionPolicy: "milestone",
    });
    await database.insert(schema.providerCalls).values({
      userId: userA,
      providerType: "stt",
      provider: "fake",
      metadata: { requestId: "private-request" },
    });
    await database.insert(schema.diagnosticEvents).values({
      userId: userA,
      eventType: "memory.conflict",
      severity: "warning",
      dedupeKey: "memory-conflict-delete-test",
      metadata: { factKey: "city" },
    });
    await database.insert(schema.evidenceEvents).values({
      userId: userA,
      practiceAttemptId: attemptA,
      idempotencyKey: "delete-evidence",
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
    await database.insert(schema.conversations).values({
      id: conversationA,
      userId: userA,
      characterId,
      identityId,
    });
    await database.insert(schema.messages).values([
      {
        id: messageUserA,
        userId: userA,
        conversationId: conversationA,
        characterId,
        identityId,
        clientMessageId: "client-lucia-reset-1",
        generationId: "generation-lucia-reset-1",
        role: "user",
        status: "completed",
        content: "Hola, Lucía.",
        completedAt: new Date(),
      },
      {
        id: messageCharacterA,
        userId: userA,
        conversationId: conversationA,
        characterId,
        identityId,
        clientMessageId: "assistant-lucia-reset-1",
        generationId: "generation-lucia-reset-1",
        role: "character",
        status: "completed",
        content: "¡Hola!",
        replyToMessageId: messageUserA,
        completedAt: new Date(),
      },
    ]);
    await database.insert(schema.relationshipMemories).values({
      id: memoryA,
      userId: userA,
      characterId,
      identityId,
      factKey: "city",
      category: "interest",
      content: "Valencia",
      confidence: 0.9,
      status: "confirmed",
    });
    await database.insert(schema.characterRelationships).values({
      userId: userA,
      characterId,
      identityId,
      relationshipStage: "familiar",
    });
    await database.insert(schema.memorySharingPermissions).values({
      userId: userA,
      memoryId: memoryA,
      targetCharacterId: characterId,
      targetIdentityId: identityId,
      isAllowed: true,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it("deletes private facts, anonymizes provider calls, and records storage cleanup", async () => {
    await database.insert(schema.userVocabularyRecallProgress).values([
      { userId: userA, word: "cafe", mode: "word", stage: "review", revision: 1, successfulReviews: 1, nextReviewAt: new Date() },
      { userId: userB, word: "cafe", mode: "word", stage: "learning", revision: 1, successfulReviews: 0 },
    ]);
    const oldEpoch = "00000000-0000-4000-8000-000000000111";
    await database.insert(schema.userVocabularyRecallSync).values({ userId: userA, epoch: oldEpoch });
    await database.insert(schema.userVocabularyRecallReceipts).values({ userId: userA, attemptId: oldEpoch, payloadHash: "hash-only" });
    await database.insert(schema.userVocabularyMarks).values([
      { userId: userA, word: "cafe", status: "familiar" },
      { userId: userB, word: "cafe", status: "learning" },
    ]);
    const result = await deleteAccountData(
      createDrizzlePrivacyRepository(database),
      storageDeleter,
      userA,
    );

    expect(result).toMatchObject({
      alreadyDeleted: false,
      cleanupDeferred: 0,
      evidenceDeleted: 1,
      providerCallsAnonymized: 1,
    });
    expect(await database.select().from(schema.userVocabularyMarks)).toEqual([
      expect.objectContaining({ userId: userB, word: "cafe", status: "learning" }),
    ]);
    expect(await database.select().from(schema.userVocabularyRecallProgress)).toEqual([
      expect.objectContaining({ userId: userB, stage: "learning" }),
    ]);
    expect(await database.select().from(schema.userVocabularyRecallReceipts)).toEqual([]);
    const [recallSync] = await database.select().from(schema.userVocabularyRecallSync).where(eq(schema.userVocabularyRecallSync.userId, userA));
    expect(recallSync.epoch).not.toBe(oldEpoch);
    expect(await database.select().from(schema.userVocabularyMarkSyncState).where(eq(schema.userVocabularyMarkSyncState.userId, userA)))
      .toEqual([{ userId: userA, legacyImportBlocked: true }]);
    await expect(
      database.select().from(schema.profiles).where(eq(schema.profiles.id, userA)),
    ).resolves.toHaveLength(0);
    await expect(
      database.select().from(schema.evidenceEvents).where(eq(schema.evidenceEvents.userId, userA)),
    ).resolves.toHaveLength(0);
    await expect(
      database.select().from(schema.conversations).where(eq(schema.conversations.userId, userA)),
    ).resolves.toHaveLength(0);
    await expect(
      database.select().from(schema.providerCalls).where(eq(schema.providerCalls.provider, "fake")),
    ).resolves.toEqual([
      expect.objectContaining({ userId: null, metadata: { anonymized: true } }),
    ]);
    await expect(
      database.select().from(schema.diagnosticEvents).where(eq(schema.diagnosticEvents.dedupeKey, "memory-conflict-delete-test")),
    ).resolves.toEqual([
      expect.objectContaining({ userId: null, eventType: "memory.conflict" }),
    ]);
    await expect(
      database.select().from(schema.privacyCleanupTasks).where(eq(schema.privacyCleanupTasks.storagePath, "user-a/milestone.webm")),
    ).resolves.toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
  });


  it("is idempotent and does not touch another user's data", async () => {
    const repository = createDrizzlePrivacyRepository(database);
    const first = await deleteAccountData(repository, storageDeleter, userA);
    const second = await deleteAccountData(repository, storageDeleter, userA);

    expect(first.alreadyDeleted).toBe(false);
    expect(second).toMatchObject({ alreadyDeleted: true, cleanupDeferred: 0 });
    await expect(
      database.select().from(schema.profiles).where(eq(schema.profiles.id, userB)),
    ).resolves.toHaveLength(1);
  });

  it("deletes Lucía data that sits on a newer revision too", async () => {
    // The 2026-10-12 v1 -> v2 rollover moved the conversation to a new revision
    // row while the relationship stayed behind. Both rows now carry the same
    // identity, which is what the deletion is scoped by.
    const newerCharacterId = "10000000-0000-4000-0000-000000000092";
    const newerConversationId = "40000000-0000-4000-0000-000000000092";
    await database.insert(schema.characters).values({
      id: newerCharacterId,
      stableKey: "lucia",
      characterVersion: 2,
      displayName: "Lucía",
      homeLocation: "Madrid",
      profile: {},
    });
    await database.insert(schema.conversations).values({ id: newerConversationId, userId: userA, characterId: newerCharacterId, identityId });
    await database.insert(schema.messages).values({
      id: "70000000-0000-4000-0000-000000000093",
      conversationId: newerConversationId,
      userId: userA,
      characterId: newerCharacterId,
      identityId,
      clientMessageId: "client-lucia-v2",
      generationId: "generation-lucia-v2",
      role: "user",
      status: "completed",
      content: "Sigo aquí.",
    });

    const result = await deleteLuciaData(createDrizzlePrivacyRepository(database), userA);

    expect(result.conversationsDeleted).toBe(2);
    expect(result.messagesDeleted).toBe(3);
    await expect(
      database.select().from(schema.conversations).where(eq(schema.conversations.characterId, newerCharacterId)),
    ).resolves.toHaveLength(0);
    await expect(
      database.select().from(schema.conversations).where(eq(schema.conversations.identityId, identityId)),
    ).resolves.toHaveLength(0);
  });

  it("deletes only Lucía conversation and relationship data", async () => {
    const result = await deleteLuciaData(
      createDrizzlePrivacyRepository(database),
      userA,
    );

    expect(result).toEqual({
      characterKey: "lucia",
      conversationsDeleted: 1,
      messagesDeleted: 2,
      relationshipMemoriesDeleted: 1,
      memoryPermissionsRevoked: 1,
      relationshipSnapshotsDeleted: 1,
    });
    await expect(deleteLuciaData(createDrizzlePrivacyRepository(database), userA)).resolves.toEqual({
      characterKey: "lucia",
      conversationsDeleted: 0,
      messagesDeleted: 0,
      relationshipMemoriesDeleted: 0,
      memoryPermissionsRevoked: 0,
      relationshipSnapshotsDeleted: 0,
    });
    await expect(
      database.select().from(schema.conversations).where(eq(schema.conversations.userId, userA)),
    ).resolves.toHaveLength(0);
    await expect(
      database.select().from(schema.messages).where(eq(schema.messages.userId, userA)),
    ).resolves.toHaveLength(0);
    await expect(
      database.select().from(schema.relationshipMemories).where(eq(schema.relationshipMemories.userId, userA)),
    ).resolves.toHaveLength(0);
    await expect(
      database.select().from(schema.characterRelationships).where(eq(schema.characterRelationships.userId, userA)),
    ).resolves.toHaveLength(0);
    await expect(
      database.select().from(schema.memorySharingPermissions).where(eq(schema.memorySharingPermissions.userId, userA)),
    ).resolves.toHaveLength(0);
    await expect(
      database.select().from(schema.evidenceEvents).where(eq(schema.evidenceEvents.userId, userA)),
    ).resolves.toHaveLength(1);
    await expect(
      database.select().from(schema.practiceAttempts).where(eq(schema.practiceAttempts.userId, userA)),
    ).resolves.toHaveLength(1);
    await expect(
      database.select().from(schema.characters).where(eq(schema.characters.id, characterId)),
    ).resolves.toHaveLength(1);
  });

  it("clears Lucía preferences and introductions across revisions while preserving other users and characters", async () => {
    const currentRevision = "10000000-0000-4000-0000-000000000094";
    const otherCharacter = "10000000-0000-4000-0000-000000000095";
    const otherIdentity = "15000000-0000-4000-0000-000000000095";
    await database.insert(schema.characters).values([
      { id: currentRevision, stableKey: "lucia", characterVersion: 2, displayName: "Lucía", homeLocation: "Madrid", profile: {} },
      { id: otherCharacter, stableKey: "mateo", displayName: "Mateo", homeLocation: "Madrid", profile: {} },
    ]);
    await database.update(schema.characterIdentities).set({ currentCharacterId: currentRevision }).where(eq(schema.characterIdentities.id, identityId));
    await database.insert(schema.characterIdentities).values({ id: otherIdentity, stableKey: "mateo", currentCharacterId: otherCharacter });
    await database.insert(schema.conversationPreferences).values([
      { userId: userA, characterId, identityId, isMuted: true, lastReadAt: new Date() },
      { userId: userA, characterId: currentRevision, identityId, isMuted: true, lastReadAt: new Date() },
      { userId: userB, characterId, identityId, isMuted: true },
      { userId: userA, characterId: otherCharacter, identityId: otherIdentity, isMuted: true },
    ]);
    const offer = { reasonCode: "shared-interest", reasonText: "Fotografía" };
    await database.insert(schema.characterIntroductionOffers).values([
      { ...offer, userId: userA, offerKey: "old-source", sourceCharacterId: characterId, sourceIdentityId: identityId, targetCharacterId: otherCharacter, targetIdentityId: otherIdentity },
      { ...offer, userId: userA, offerKey: "current-source", sourceCharacterId: currentRevision, sourceIdentityId: identityId, targetCharacterId: otherCharacter, targetIdentityId: otherIdentity },
      { ...offer, userId: userA, offerKey: "lucia-target", sourceCharacterId: otherCharacter, sourceIdentityId: otherIdentity, targetCharacterId: characterId, targetIdentityId: identityId },
      { ...offer, userId: userB, offerKey: "other-user", sourceCharacterId: characterId, sourceIdentityId: identityId, targetCharacterId: otherCharacter, targetIdentityId: otherIdentity },
      { ...offer, userId: userA, offerKey: "other-character", sourceCharacterId: otherCharacter, sourceIdentityId: otherIdentity, targetCharacterId: otherCharacter, targetIdentityId: otherIdentity },
    ]);
    await database.insert(schema.characterRelationships).values({ userId: userA, characterId: otherCharacter, identityId: otherIdentity, relationshipStage: "familiar" });

    await deleteLuciaData(createDrizzlePrivacyRepository(database), userA);

    const preferences = await database.select().from(schema.conversationPreferences);
    expect(preferences).toHaveLength(2);
    expect(preferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: userB, identityId, isMuted: true }),
      expect.objectContaining({ userId: userA, identityId: otherIdentity, isMuted: true }),
    ]));
    const introductions = await database.select().from(schema.characterIntroductionOffers);
    expect(introductions.map((row) => row.offerKey).sort()).toEqual(["other-character", "other-user"]);
    expect(await database.select().from(schema.characterRelationships)).toEqual([
      expect.objectContaining({ userId: userA, identityId: otherIdentity, relationshipStage: "familiar" }),
    ]);
    expect(await database.select().from(schema.evidenceEvents)).toHaveLength(1);
    expect(await database.select().from(schema.practiceAttempts)).toHaveLength(1);
  });
});
