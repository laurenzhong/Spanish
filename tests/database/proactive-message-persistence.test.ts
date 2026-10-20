// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDrizzleProactiveMessageRepository, evaluateProactiveEligibility } from "@/src/modules/conversation";
import { conversationCharacterVersion } from "@/src/modules/conversation/domain/character-catalog";
import * as schema from "@/src/shared/db/schema";

const userId = "00000000-0000-4000-8000-000000000091";
const characterId = "10000000-0000-4000-8000-000000000091";
const identityId = "40000000-0000-4000-8000-000000000091";
const conversationId = "20000000-0000-4000-8000-000000000091";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
}

describe("proactive message persistence", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    await client.exec((await migration("0000_big_phalanx.sql")) + (await migration("0005_kind_character_network.sql")) + (await migration("0013_smart_stick.sql")) + (await migration("0016_proactive_messages.sql")) + (await migration("0017_sudden_betty_brant.sql")) + (await migration("0045_lumpy_medusa.sql")));
    database = drizzle(client, { schema });
    await client.exec(`insert into profiles (id, display_name) values ('${userId}', 'Test');`);
    // Follow the catalog instead of a literal: the proactive path resolves the
    // current revision, so a fixture pinned to v1 would not be found.
    await database.insert(schema.characters).values({ id: characterId, stableKey: "lucia", displayName: "Lucía", homeLocation: "Madrid", profile: {}, characterVersion: conversationCharacterVersion("lucia") ?? 1, status: "published" });
    await database.insert(schema.characterIdentities).values({ id: identityId, stableKey: "lucia", currentCharacterId: characterId });
    await database.insert(schema.characterRelationships).values({ userId, characterId, identityId, status: "active", relationshipStage: "familiar", relationshipSummary: { es: "Fotografía urbana" } });
    await database.insert(schema.conversations).values({ id: conversationId, userId, characterId, identityId });
  });

  afterEach(async () => { await client.close(); });

  it("keeps an empty or opening-only contact quiet until a completed user message exists", async () => {
    const repository = createDrizzleProactiveMessageRepository(database);
    const now = new Date("2026-10-16T12:00:00Z");
    expect(evaluateProactiveEligibility(await repository.getEligibilityState(userId, now), now))
      .toMatchObject({ allowed: false, reason: "awaiting-first-user-message" });
    await database.insert(schema.messages).values({
      userId, conversationId, characterId, identityId,
      clientMessageId: "opening", role: "character", status: "completed",
      sourceType: "authored_opening", content: "Hola, soy Lucía.",
    });
    expect(evaluateProactiveEligibility(await repository.getEligibilityState(userId, now), now))
      .toMatchObject({ allowed: false, reason: "awaiting-first-user-message" });
    await database.insert(schema.messages).values({
      userId, conversationId, characterId, identityId,
      clientMessageId: "withdrawn-user", role: "user", status: "withdrawn", content: "Hola.",
    });
    expect(evaluateProactiveEligibility(await repository.getEligibilityState(userId, now), now).allowed).toBe(false);
    await database.insert(schema.messages).values({
      userId, conversationId, characterId, identityId,
      clientMessageId: "first-user", role: "user", status: "completed", content: "Hola, Lucía.",
    });
    expect(evaluateProactiveEligibility(await repository.getEligibilityState(userId, now), now))
      .toEqual({ allowed: true, reason: "eligible" });
  });

  it("resolves an active historical relationship and a current conversation through the same identity", async () => {
    const historicalCharacterId = "10000000-0000-4000-8000-000000000092";
    await database.insert(schema.characters).values({ id: historicalCharacterId, stableKey: "lucia", displayName: "Lucía", homeLocation: "Madrid", profile: {}, characterVersion: 1, status: "published" });
    await database.update(schema.characterRelationships).set({ characterId: historicalCharacterId })
      .where(eq(schema.characterRelationships.userId, userId));

    // The deployed legacy query finds the active v1 relationship, but no v1
    // conversation. Reproduce that split before verifying identity resolution.
    const legacyConversations = await database.select().from(schema.conversations)
      .where(and(eq(schema.conversations.userId, userId), eq(schema.conversations.characterId, historicalCharacterId)));
    expect(legacyConversations).toHaveLength(0);
    const repository = createDrizzleProactiveMessageRepository(database);
    expect(await repository.getConversationId(userId)).toBe(conversationId);
    expect(await repository.getEligibilityState(userId, new Date("2026-10-14T13:05:38Z")))
      .toMatchObject({ relationshipStatus: "active", relationshipStage: "familiar", relationshipSummary: "Fotografía urbana" });
    await expect(repository.getConversationId("00000000-0000-4000-8000-000000000099"))
      .rejects.toThrow("CONVERSATION_UNAVAILABLE");
    expect(await database.select().from(schema.proactiveMessageCandidates)).toHaveLength(0);
    expect(await database.select().from(schema.messages)).toHaveLength(0);
  });

  it("lists completed conversation messages for proactive context, oldest first", async () => {
    const repository = createDrizzleProactiveMessageRepository(database);
    await database.insert(schema.messages).values([
      { userId, conversationId, characterId, identityId, clientMessageId: "message-1", role: "character", status: "completed", sourceType: "authored_opening", content: "Hola, soy Lucía.", createdAt: new Date("2026-08-29T08:00:00.000Z") },
      { userId, conversationId, characterId, identityId, clientMessageId: "message-2", role: "user", status: "completed", content: "A mí me gusta fotografiar temas de gente y paisajes.", createdAt: new Date("2026-08-29T08:05:00.000Z") },
      { userId, conversationId, characterId, identityId, clientMessageId: "message-3", role: "user", status: "withdrawn", content: "Mensaje retirado.", createdAt: new Date("2026-08-29T08:10:00.000Z") },
      { userId, conversationId, characterId, identityId, clientMessageId: "message-4", role: "character", status: "streaming", content: "Respuesta a medias", createdAt: new Date("2026-08-29T08:15:00.000Z") },
    ]);
    const messages = await repository.listRecentMessages(userId);
    expect(messages.map((message) => message.clientMessageId)).toEqual(["message-1", "message-2"]);
    expect(messages[1]?.content).toBe("A mí me gusta fotografiar temas de gente y paisajes.");
    const latest = await repository.listRecentMessages(userId, 1);
    expect(latest.map((message) => message.clientMessageId)).toEqual(["message-2"]);

    // Another user's conversation never leaks into this context, even though
    // both conversations point at the same character identity.
    const otherUserId = "00000000-0000-4000-8000-000000000092";
    const otherConversationId = "20000000-0000-4000-8000-000000000092";
    await client.exec(`insert into profiles (id, display_name) values ('${otherUserId}', 'Other');`);
    await database.insert(schema.conversations).values({ id: otherConversationId, userId: otherUserId, characterId, identityId });
    await database.insert(schema.messages).values({ userId: otherUserId, conversationId: otherConversationId, characterId, identityId, clientMessageId: "other-message", role: "user", status: "completed", content: "Mensaje de otra persona.", createdAt: new Date("2026-08-29T08:20:00.000Z") });
    expect((await repository.listRecentMessages(otherUserId)).map((message) => message.clientMessageId)).toEqual(["other-message"]);
    expect((await repository.listRecentMessages(userId)).map((message) => message.clientMessageId)).toEqual(["message-1", "message-2"]);
  });

  it("stores a generated candidate and message atomically and is idempotent", async () => {
    const repository = createDrizzleProactiveMessageRepository(database);
    const now = new Date("2026-08-29T10:00:00.000Z");
    const state = await repository.getEligibilityState(userId, now);
    expect(state).toMatchObject({ relationshipStatus: "active", relationshipStage: "familiar", proactiveCount24h: 0, proactiveCount7d: 0 });
    const candidate = await repository.createCandidate({ userId, conversationId, sourceType: "spontaneous_affection", dedupeKey: "lucia:spontaneous_affection:2026-08-29", generationId: "generation-1", notBefore: now });
    const completed = await repository.completeCandidate({ userId, candidateId: candidate.id, messageId: "30000000-0000-4000-8000-000000000091", generationId: "generation-1", content: "Me acordé de ti esta mañana." });
    const repeated = await repository.createCandidate({ userId, conversationId, sourceType: "spontaneous_affection", dedupeKey: "lucia:spontaneous_affection:2026-08-29", generationId: "generation-2", notBefore: now });
    expect(repeated.id).toBe(candidate.id);
    expect(completed.candidate.status).toBe("generated");
    expect(completed.message.sourceType).toBe("proactive");
    const rows = await database.select().from(schema.messages).where(and(eq(schema.messages.userId, userId), eq(schema.messages.sourceType, "proactive")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ characterId, identityId });
    const [storedCandidate] = await database.select().from(schema.proactiveMessageCandidates).where(eq(schema.proactiveMessageCandidates.userId, userId));
    expect(storedCandidate).toMatchObject({ characterId, identityId });
  });
});
