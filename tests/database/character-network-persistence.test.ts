// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import inesSource from "@/content/characters/ines.json";
import {
  createDrizzleCharacterRepository,
  importCharacterBible,
  publishCharacterBible,
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
const conversationId = "20000000-0000-4000-8000-000000000061";
const memoryId = "30000000-0000-4000-8000-000000000061";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
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
    for (const name of ["0000_big_phalanx.sql", "0001_auth_rls.sql", "0002_content_import_registry.sql", "0003_chunky_black_knight.sql", "0004_calm_iron_monger.sql", "0005_kind_character_network.sql", "0016_proactive_messages.sql"]) {
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
    await database.insert(schema.conversations).values({ id: conversationId, userId, characterId: luciaId });
    await database.insert(schema.relationshipMemories).values({ id: memoryId, userId, characterId: luciaId, factKey: "interest.photo", category: "interest", content: "fotografía", confidence: 0.9, sensitivity: "normal", status: "candidate" });
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
    const [permission] = await database.select().from(schema.memorySharingPermissions).where(eq(schema.memorySharingPermissions.memoryId, memoryId));
    expect(permission?.targetCharacterId).toBe(mateoId);
    const [offer] = await database.select().from(schema.characterIntroductionOffers).where(eq(schema.characterIntroductionOffers.userId, userId));
    expect(offer?.status).toBe("accepted");

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

  it("does not create an introduction for a draft target", async () => {
    const draftId = "10000000-0000-4000-8000-000000000063";
    await database.insert(schema.characters).values({
      id: draftId,
      stableKey: "ines",
      displayName: "Inés",
      homeLocation: "Barcelona",
      profile: {},
      characterVersion: 1,
      status: "draft",
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
