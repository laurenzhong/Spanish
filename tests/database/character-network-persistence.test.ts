// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import inesSource from "@/content/characters/ines.json";
import luciaSource from "@/content/characters/lucia.json";
import mateoSource from "@/content/characters/mateo.json";
import {
  createDrizzleCharacterRepository,
  importCharacterBible,
  publishCharacterBible,
  publishCharacterBibles,
  validateCharacterBible,
} from "@/src/modules/characters";
import {
  createDrizzleIntroductionRepository,
  createDrizzleLuciaContactRepository,
  getLuciaContact,
  proposeIntroduction,
  respondToIntroduction,
} from "@/src/modules/character-network";
import * as schema from "@/src/shared/db/schema";

const userId = "00000000-0000-4000-8000-000000000061";
const luciaId = "10000000-0000-4000-8000-000000000061";
const mateoId = "10000000-0000-4000-8000-000000000062";
const inesId = "10000000-0000-4000-8000-000000000063";
const luciaIdentityId = "40000000-0000-4000-8000-000000000061";
const mateoIdentityId = "40000000-0000-4000-8000-000000000062";
const inesIdentityId = "40000000-0000-4000-8000-000000000063";
const conversationId = "20000000-0000-4000-8000-000000000061";
const memoryId = "30000000-0000-4000-8000-000000000061";

/**
 * A second importable character for the multi-character publish test. Mateo's
 * fixture row above is not his real content, so reusing his key would collide
 * with the import conflict check; this key has no fixture at all.
 */
const probeDraft = {
  ...(structuredClone(inesSource) as Record<string, unknown>),
  stableKey: "probe-batch",
  displayName: "Probe",
  version: 1,
  changeLog: [],
};

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
}

/**
 * Every user-state row the publish of a revision must not touch (ADR 0014's
 * whole point). Snapshot before/after: any write shows up as a changed count,
 * `updated_at` or `character_id`.
 */
async function userStateSnapshot(database: ReturnType<typeof drizzle<typeof schema>>) {
  return {
    conversations: await database
      .select({ id: schema.conversations.id, characterId: schema.conversations.characterId, updatedAt: schema.conversations.updatedAt })
      .from(schema.conversations)
      .orderBy(schema.conversations.id),
    messages: await database
      .select({ id: schema.messages.id, characterId: schema.messages.characterId, updatedAt: schema.messages.updatedAt })
      .from(schema.messages)
      .orderBy(schema.messages.id),
    relationships: await database
      .select({ id: schema.characterRelationships.id, characterId: schema.characterRelationships.characterId, updatedAt: schema.characterRelationships.updatedAt })
      .from(schema.characterRelationships)
      .orderBy(schema.characterRelationships.id),
    preferences: await database
      .select({ userId: schema.conversationPreferences.userId, characterId: schema.conversationPreferences.characterId, isPinned: schema.conversationPreferences.isPinned, updatedAt: schema.conversationPreferences.updatedAt })
      .from(schema.conversationPreferences)
      .orderBy(schema.conversationPreferences.userId),
    memories: await database
      .select({ id: schema.relationshipMemories.id, characterId: schema.relationshipMemories.characterId, updatedAt: schema.relationshipMemories.updatedAt })
      .from(schema.relationshipMemories)
      .orderBy(schema.relationshipMemories.id),
    permissions: await database
      .select({ memoryId: schema.memorySharingPermissions.memoryId, targetCharacterId: schema.memorySharingPermissions.targetCharacterId, updatedAt: schema.memorySharingPermissions.updatedAt })
      .from(schema.memorySharingPermissions)
      .orderBy(schema.memorySharingPermissions.memoryId),
  };
}

/** The revision a stable key's identity currently points at. */
async function pointerRevision(database: ReturnType<typeof drizzle<typeof schema>>, stableKey: string) {
  const [identity] = await database
    .select({ id: schema.characterIdentities.id, currentCharacterId: schema.characterIdentities.currentCharacterId })
    .from(schema.characterIdentities)
    .where(eq(schema.characterIdentities.stableKey, stableKey));
  return identity ?? null;
}

describe("character network persistence", () => {
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
    for (const name of ["0000_big_phalanx.sql", "0001_auth_rls.sql", "0002_content_import_registry.sql", "0003_chunky_black_knight.sql", "0004_calm_iron_monger.sql", "0005_kind_character_network.sql", "0016_proactive_messages.sql", "0017_sudden_betty_brant.sql", "0018_dusty_sue_storm.sql", "0040_happy_wolverine.sql", "0045_lumpy_medusa.sql"]) {
      await client.exec(await migration(name));
    }
    database = drizzle(client, { schema });
    await client.exec(`insert into auth.users (id, email) values ('${userId}', 'network@example.test');`);
    await database.insert(schema.characters).values([
      // Published fixtures are intentional: network persistence must prove
      // that active roles can be connected, while draft-gate behavior is
      // covered separately below.
      { id: luciaId, stableKey: "lucia", displayName: "Lucía", homeLocation: "Madrid", profile: {}, characterVersion: 1, status: "published" },
      { id: mateoId, stableKey: "mateo", displayName: "Mateo", homeLocation: "Valencia", profile: {}, characterVersion: 1, status: "published" },
    ]);
    await database.insert(schema.characterIdentities).values([
      { id: luciaIdentityId, stableKey: "lucia", currentCharacterId: luciaId },
      { id: mateoIdentityId, stableKey: "mateo", currentCharacterId: mateoId },
    ]);
    await database.insert(schema.conversations).values({ id: conversationId, userId, characterId: luciaId, identityId: luciaIdentityId });
    await database.insert(schema.relationshipMemories).values({ id: memoryId, userId, characterId: luciaId, identityId: luciaIdentityId, factKey: "interest.photo", category: "interest", content: "fotografía", confidence: 0.9, sensitivity: "normal", status: "candidate" });
  });

  afterEach(async () => { await client.close(); });

  it("creates an independent target relationship and only explicit safe memory permission", async () => {
    const repository = createDrizzleIntroductionRepository(database);
    const proposed = await proposeIntroduction({ repository, candidate: {
      userId, sourceCharacterKey: "lucia", sourceCharacterVersion: 1,
      targetCharacterKey: "mateo", targetCharacterVersion: 1,
      recentMessages: [{ role: "user", content: "Me encanta la fotografía" }],
    } });
    expect(proposed.offer?.status).toBe("pending");
    const accepted = await respondToIntroduction({ repository, userId, offerKey: proposed.offer!.offerKey, decision: "accept", memoryIds: [memoryId] });
    expect("relationship" in accepted && accepted.relationship.characterKey).toBe("mateo");
    const [relationship] = await database.select().from(schema.characterRelationships).where(eq(schema.characterRelationships.userId, userId));
    expect(relationship?.characterId).toBe(mateoId);
    expect(relationship?.identityId).toBe(mateoIdentityId);
    const [permission] = await database.select().from(schema.memorySharingPermissions).where(eq(schema.memorySharingPermissions.memoryId, memoryId));
    expect(permission?.targetCharacterId).toBe(mateoId);
    expect(permission?.targetIdentityId).toBe(mateoIdentityId);
    const [offer] = await database.select().from(schema.characterIntroductionOffers).where(eq(schema.characterIntroductionOffers.userId, userId));
    expect(offer?.status).toBe("accepted");
    expect(offer).toMatchObject({ sourceIdentityId: luciaIdentityId, targetIdentityId: mateoIdentityId });

    const shareable = await repository.listShareableMemoryPreviews(userId, "lucia", "mateo");
    expect(shareable).toEqual([expect.objectContaining({ id: memoryId, alreadyShared: true, sensitivity: "normal" })]);
    expect(await repository.listGrantedMemoryPreviews(userId)).toEqual([expect.objectContaining({ id: memoryId, characterKey: "lucia", targetCharacterKey: "mateo" })]);
    await repository.revokeMemoryPermission(userId, memoryId, "mateo");
    expect(await repository.listGrantedMemoryPreviews(userId)).toHaveLength(0);
    const [memory] = await database.select({ shareScope: schema.relationshipMemories.shareScope }).from(schema.relationshipMemories).where(eq(schema.relationshipMemories.id, memoryId));
    expect(memory?.shareScope).toBe("private");
  });

  it("is idempotent when the same accepted offer is retried", async () => {
    const repository = createDrizzleIntroductionRepository(database);
    const proposed = await proposeIntroduction({ repository, candidate: {
      userId, sourceCharacterKey: "lucia", sourceCharacterVersion: 1,
      targetCharacterKey: "mateo", targetCharacterVersion: 1,
      recentMessages: [{ role: "user", content: "Me gusta la música" }],
    } });
    const first = await respondToIntroduction({ repository, userId, offerKey: proposed.offer!.offerKey, decision: "accept" });
    const second = await respondToIntroduction({ repository, userId, offerKey: proposed.offer!.offerKey, decision: "accept" });
    expect("relationship" in first).toBe(true);
    expect("relationship" in second).toBe(false);
    expect((second as { status: string }).status).toBe("accepted");
    expect((await database.select().from(schema.characterRelationships))).toHaveLength(1);
    expect((await database.select().from(schema.conversations))).toHaveLength(2);
  });

  it("starts Lucía as a pending request and creates the contact only after acceptance", async () => {
    await database.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    const repository = createDrizzleLuciaContactRepository(database);
    expect((await repository.get(userId)).status).toBe("pending");
    const accepted = await repository.transaction((tx) => tx.respond(userId, "accept"));
    expect(accepted).toMatchObject({ status: "active", relationshipStage: "new_contact" });
    expect(accepted.conversationId).toBeTruthy();
    expect((await repository.get(userId)).status).toBe("active");
    expect((await database.select().from(schema.characterRelationships))).toHaveLength(1);
    expect((await database.select().from(schema.conversations))).toHaveLength(1);
    const [opening] = await database.select().from(schema.messages).where(eq(schema.messages.conversationId, accepted.conversationId!));
    expect(opening).toMatchObject({ role: "character", clientMessageId: "lucia-authored-opening-v1", content: "En la historia ficticia de Lucía, aquella conversación sobre fotografía urbana se quedó como un recuerdo bonito. Me dio curiosidad seguir hablando contigo por aquí." });
    await repository.transaction((tx) => tx.respond(userId, "accept").then(() => tx.ensureAuthoredOpeningMessage(userId)));
    expect((await database.select().from(schema.messages))).toHaveLength(1);
    await database.delete(schema.messages).where(eq(schema.messages.clientMessageId, "lucia-authored-opening-v1"));
    await getLuciaContact({ repository, userId });
    expect((await database.select().from(schema.messages))).toHaveLength(1);
  });

  it("records a declined Lucía request without creating a conversation", async () => {
    await database.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    const repository = createDrizzleLuciaContactRepository(database);
    const declined = await repository.respond(userId, "decline");
    expect(declined.status).toBe("declined");
    expect(declined.conversationId).toBeNull();
    expect((await database.select().from(schema.characterRelationships))).toHaveLength(1);
    expect((await database.select().from(schema.conversations))).toHaveLength(0);
  });

  it("publishes a character and records the three temporary review decisions", async () => {
    const repository = createDrizzleCharacterRepository(database);
    await importCharacterBible(repository, inesSource);
    const result = await publishCharacterBible({
      repository,
      source: inesSource,
      reviewedAt: new Date("2026-08-25T04:00:00.000Z"),
    });
    expect(result.status).toBe("published");
    const [character] = await database.select({ status: schema.characters.status }).from(schema.characters).where(eq(schema.characters.stableKey, "ines"));
    expect(character?.status).toBe("published");
    const reviews = await database.select().from(schema.contentReviews).where(eq(schema.contentReviews.entityType, "character"));
    expect(reviews).toHaveLength(3);
    expect(reviews.every((review) => review.reviewerReference?.startsWith("codex-ai-temporary-review:") === true)).toBe(true);
  });

  it("publishes the identity pointer onto the new revision and writes no user state", async () => {
    // User state seeded on Lucía's published v1 (the shape ADR 0014 was written
    // for), then a newer revision of the same key is published below.
    await database.insert(schema.characterRelationships).values({
      userId, characterId: luciaId, identityId: luciaIdentityId, status: "active", relationshipStage: "familiar",
    });
    await database.insert(schema.conversationPreferences).values({
      userId, characterId: luciaId, identityId: luciaIdentityId, isPinned: true,
    });
    await database.insert(schema.messages).values({
      userId, conversationId, characterId: luciaId, identityId: luciaIdentityId,
      clientMessageId: "identity-pointer-proof", role: "character", content: "Seguimos hablando.",
    });
    await database.insert(schema.proactiveMessageCandidates).values({
      userId, characterId: luciaId, identityId: luciaIdentityId, conversationId,
      sourceType: "scheduled", dedupeKey: "identity-pointer-dedupe", generationId: "generation-1",
      notBefore: new Date("2026-10-12T00:00:00.000Z"),
    });
    const before = await userStateSnapshot(database);

    const repository = createDrizzleCharacterRepository(database);
    const luciaV2Source = {
      ...(structuredClone(luciaSource) as Record<string, unknown>),
      version: 2,
      changeLog: [{ version: 2, supersedesVersion: 1, changeReason: "Añade dos reglas de expresión." }],
    };
    await importCharacterBible(repository, luciaV2Source);
    const result = await publishCharacterBible({
      repository,
      source: luciaV2Source,
      current: { ...validateCharacterBible(structuredClone(luciaSource)), version: 1, changeLog: [] },
    });

    // The pointer is the only thing that moved, and it names the published row.
    const pointer = await pointerRevision(database, "lucia");
    expect(pointer?.currentCharacterId).toBe(result.character.id);
    expect(pointer?.currentCharacterId).not.toBe(luciaId);
    const [published] = await database
      .select({ status: schema.characters.status, version: schema.characters.characterVersion })
      .from(schema.characters)
      .where(eq(schema.characters.id, result.character.id));
    expect(published).toEqual({ status: "published", version: 2 });
    expect((await database.select().from(schema.characters).where(eq(schema.characters.id, luciaId)))[0]?.status).toBe("published");
    // Revision 2 was served by moving lucia's existing identity, not by minting
    // a second one next to it.
    expect((await database
      .select({ stableKey: schema.characterIdentities.stableKey })
      .from(schema.characterIdentities))
      .map((identity) => identity.stableKey)
      .sort()).toEqual(["lucia", "mateo"]);

    // ADR 0014 acceptance: publishing a revision writes no user-state row.
    expect(await userStateSnapshot(database)).toEqual(before);
    expect(before.conversations).not.toHaveLength(0);
    expect(before.messages).toHaveLength(1);
    expect(before.relationships).toHaveLength(1);
    expect(before.preferences).toHaveLength(1);
  });

  it("leaves the pointer on the published revision when the publish is rejected", async () => {
    const repository = createDrizzleCharacterRepository(database);
    await importCharacterBible(repository, inesSource);
    const inesV1 = await repository.findByStableVersion("ines", 1);
    expect(await pointerRevision(database, "ines")).toBeNull();

    // Version 2 with no superseded revision: the gate refuses it before any
    // write, which must also mean the draft stays a draft and no identity with a
    // draft pointer appears.
    const inesV2 = {
      ...(structuredClone(inesSource) as Record<string, unknown>),
      version: 2,
      changeLog: [{ version: 2, supersedesVersion: 1, changeReason: "Ajusta el tono." }],
    };
    await importCharacterBible(repository, inesV2);
    await expect(publishCharacterBible({ repository, source: inesV2 }))
      .rejects.toMatchObject({ code: "CHARACTER_REVIEW_INVALID" });

    expect(await pointerRevision(database, "ines")).toBeNull();
    const revisions = await database
      .select({ version: schema.characters.characterVersion, status: schema.characters.status })
      .from(schema.characters)
      .where(eq(schema.characters.stableKey, "ines"));
    expect(revisions.every((revision) => revision.status === "draft")).toBe(true);

    // Publishing the v1 revision still works and creates the identity then.
    const published = await publishCharacterBible({ repository, source: inesSource });
    expect((await pointerRevision(database, "ines"))?.currentCharacterId).toBe(published.character.id);
    expect(inesV1?.status).toBe("draft");
  });

  it("moves every pointer when several characters are published in one transaction", async () => {
    // Two keys with no identity row at all, published by one call. Mateo is
    // deliberately not one of them: the fixture row above is not his imported
    // content, so his key would collide with the import conflict check.
    const probeId = "10000000-0000-4000-8000-000000000066";
    await database.insert(schema.characters).values({
      id: probeId, stableKey: "probe-batch", displayName: "Probe", homeLocation: "Sevilla",
      profile: {}, characterVersion: 1, status: "draft",
    });
    const repository = createDrizzleCharacterRepository(database);
    await importCharacterBible(repository, inesSource);

    const results = await publishCharacterBibles({
      repository,
      sources: [inesSource, structuredClone(probeDraft)],
    });

    expect(results.map((result) => result.status)).toEqual(["published", "published"]);
    const [ines, probe] = results;
    expect((await pointerRevision(database, "ines"))?.currentCharacterId).toBe(ines!.character.id);
    expect((await pointerRevision(database, "probe-batch"))?.currentCharacterId).toBe(probe!.character.id);
    // The pre-existing Lucía identity is not disturbed by another character's publish.
    expect((await pointerRevision(database, "lucia"))?.currentCharacterId).toBe(luciaId);
    // One identity per `stable_key`, never one per revision (ADR 0014). The
    // fixture already holds identities for lucia and mateo (beforeEach), and
    // this call's two publishes add ines and probe-batch. Asserting the exact
    // key set — not just a count — is what rules out a version-scoped identity
    // such as `ines@1`: a duplicate or versioned key fails here even though the
    // row count could still match.
    const identities = await database
      .select({ stableKey: schema.characterIdentities.stableKey })
      .from(schema.characterIdentities);
    expect(identities.map((identity) => identity.stableKey).sort())
      .toEqual(["ines", "lucia", "mateo", "probe-batch"]);
  });

  it("keeps the current pointer when an already published revision is published again", async () => {
    const repository = createDrizzleCharacterRepository(database);
    await importCharacterBible(repository, inesSource);
    const first = await publishCharacterBible({ repository, source: inesSource });

    const repeated = await publishCharacterBible({ repository, source: inesSource });

    expect(repeated.status).toBe("unchanged");
    expect((await pointerRevision(database, "ines"))?.currentCharacterId).toBe(first.character.id);
  });

  it("finds Lucía's relationship and conversation when both still sit on a superseded revision", async () => {
    // The live database shape the ADR was written for: the released revision is
    // v2 while the relationship (and, before slice 2, the conversation) stayed
    // on v1. The v1-keyed gate found the relationship but reported a null
    // conversation and would have inserted a second one on the next accept.
    const luciaV2Id = "10000000-0000-4000-8000-000000000064";
    await database.insert(schema.characters).values({
      id: luciaV2Id, stableKey: "lucia", displayName: "Lucía", homeLocation: "Madrid", profile: {}, characterVersion: 2, status: "published",
    });
    await database.insert(schema.characterRelationships).values({
      userId, characterId: luciaId, identityId: luciaIdentityId, status: "active", relationshipStage: "familiar",
    });
    await database.update(schema.characterIdentities)
      .set({ currentCharacterId: luciaV2Id })
      .where(eq(schema.characterIdentities.id, luciaIdentityId));

    const repository = createDrizzleLuciaContactRepository(database);
    await expect(repository.get(userId)).resolves.toMatchObject({
      characterKey: "lucia",
      status: "active",
      relationshipStage: "familiar",
      conversationId,
    });

    await repository.transaction((tx) => tx.respond(userId, "accept"));
    expect(await database.select().from(schema.conversations)).toHaveLength(1);
    const [opening] = await database.select().from(schema.messages).where(eq(schema.messages.clientMessageId, "lucia-authored-opening-v1"));
    expect(opening).toMatchObject({ characterId: luciaV2Id, identityId: luciaIdentityId });
  });

  it("fails closed when Lucía's identity points at an unpublished revision", async () => {
    await database.insert(schema.characterRelationships).values({
      userId, characterId: luciaId, identityId: luciaIdentityId, status: "active",
    });
    await database.update(schema.characters).set({ status: "draft" }).where(eq(schema.characters.id, luciaId));
    const repository = createDrizzleLuciaContactRepository(database);

    await expect(repository.get(userId)).rejects.toThrow("CHARACTER_UNAVAILABLE");
  });

  it("does not create an introduction for a draft target", async () => {
    const draftId = "10000000-0000-4000-8000-000000000065";
    await database.insert(schema.characters).values({
      id: draftId,
      stableKey: "ines",
      displayName: "Inés",
      homeLocation: "Barcelona",
      profile: {},
      characterVersion: 1,
      status: "draft",
    });
    await database.insert(schema.characterIdentities).values({
      id: inesIdentityId, stableKey: "ines", currentCharacterId: draftId,
    });
    const repository = createDrizzleIntroductionRepository(database);
    await expect(proposeIntroduction({ repository, candidate: {
      userId,
      sourceCharacterKey: "lucia",
      sourceCharacterVersion: 1,
      targetCharacterKey: "ines",
      targetCharacterVersion: 1,
      recentMessages: [{ role: "user", content: "trabajo" }],
    } })).rejects.toThrow("CHARACTER_UNAVAILABLE");
    expect(await database.select().from(schema.characterRelationships)).toHaveLength(0);
  });

  it("keeps the source character gate when accepting without shared memories", async () => {
    const repository = createDrizzleIntroductionRepository(database);
    const proposed = await proposeIntroduction({ repository, candidate: {
      userId,
      sourceCharacterKey: "lucia",
      sourceCharacterVersion: 1,
      targetCharacterKey: "mateo",
      targetCharacterVersion: 1,
      recentMessages: [{ role: "user", content: "Me encanta la fotografía" }],
    } });
    await database.update(schema.characters)
      .set({ status: "draft" })
      .where(eq(schema.characters.id, luciaId));

    await expect(respondToIntroduction({
      repository,
      userId,
      offerKey: proposed.offer!.offerKey,
      decision: "accept",
      memoryIds: [],
    })).rejects.toThrow("CHARACTER_UNAVAILABLE");
    expect(await database.select().from(schema.characterRelationships)).toHaveLength(0);
    expect(await database.select().from(schema.conversations)).toHaveLength(1);
  });

  it("keeps privacy revocation available after a target character is drafted", async () => {
    const repository = createDrizzleIntroductionRepository(database);
    await database.insert(schema.memorySharingPermissions).values({
      userId,
      memoryId,
      targetCharacterId: mateoId,
      targetIdentityId: mateoIdentityId,
      isAllowed: true,
    });
    await database.update(schema.relationshipMemories)
      .set({ shareScope: "explicit" })
      .where(eq(schema.relationshipMemories.id, memoryId));
    await database.update(schema.characters)
      .set({ status: "draft" })
      .where(eq(schema.characters.id, mateoId));

    await repository.revokeMemoryPermission(userId, memoryId, "mateo");

    expect(await repository.listGrantedMemoryPreviews(userId)).toHaveLength(0);
    const [memory] = await database.select({ shareScope: schema.relationshipMemories.shareScope })
      .from(schema.relationshipMemories)
      .where(eq(schema.relationshipMemories.id, memoryId));
    expect(memory?.shareScope).toBe("private");
  });
});
