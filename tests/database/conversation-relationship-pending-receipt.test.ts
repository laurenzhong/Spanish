// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzleConversationRepository } from "@/src/modules/conversation";
import { readRelationshipConversationContext } from "@/src/modules/character-network/repositories/relationship-context";
import { tombstoneRelationshipSourcesForMessage } from "@/src/modules/character-network/repositories/relationship-source-invalidation";
import * as schema from "@/src/shared/db/schema";

const userId = "00000000-0000-4000-8000-000000000091";
const characterId = "10000000-0000-4000-8000-000000000091";
const identityId = "20000000-0000-4000-8000-000000000091";

describe("conversation completion relationship receipt", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let repository: ReturnType<typeof createDrizzleConversationRepository>;
  let conversationId: string;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;");
    for (const file of ["0000_big_phalanx.sql", "0003_chunky_black_knight.sql", "0005_kind_character_network.sql", "0013_smart_stick.sql", "0016_proactive_messages.sql", "0017_sudden_betty_brant.sql", "0018_dusty_sue_storm.sql", "0040_happy_wolverine.sql", "0045_lumpy_medusa.sql", "0047_conversation_reply_sources.sql", "0056_character_relationship_state.sql"]) {
      await client.exec((await readFile(path.join(process.cwd(), "drizzle", file), "utf8")).replaceAll("--> statement-breakpoint", ""));
    }
    database = drizzle(client, { schema });
    await client.exec(`insert into profiles (id) values ('${userId}'); insert into characters (id,stable_key,display_name,home_location,profile,status) values ('${characterId}','lucia','Lucía','Madrid','{}','published'); insert into character_identities (id,stable_key,current_character_id) values ('${identityId}','lucia','${characterId}');`);
    repository = createDrizzleConversationRepository(database);
    conversationId = await repository.getOrCreateConversation(userId, "lucia", 1);
  });

  afterEach(async () => client.close());

  async function claim(generationId: string) {
    return repository.claimReplyGeneration!({
      userId,
      conversationId,
      characterKey: "lucia",
      generationId,
      messageId: randomUUID(),
      messages: [{ clientMessageId: `u-${generationId}`, text: "Me gusta la fotografía." }],
    });
  }

  it("records one pending receipt after completion and deduplicates retries", async () => {
    const generation = await claim("g1");
    await repository.saveReplyPrefix!({ userId, conversationId, generationId: "g1", prefix: "Qué bonito." });
    await expect(repository.finishReplyGeneration!({ userId, conversationId, generationId: "g1", content: "Qué bonito." })).resolves.toMatchObject({ status: "completed" });
    await expect(repository.finishReplyGeneration!({ userId, conversationId, generationId: "g1", content: "Qué bonito." })).resolves.toBeNull();
    const rows = (await client.query<{ receipt_key: string; generation_id: string; turn_id: string }>("select receipt_key,generation_id,turn_id from relationship_pending_sources")).rows;
    expect(rows).toEqual([{ receipt_key: "generation:g1", generation_id: "g1", turn_id: generation.assistant.id }]);
  });

  it("does not create a receipt for rejected completion", async () => {
    await claim("g1");
    await expect(repository.finishReplyGeneration!({ userId, conversationId, generationId: "g1", content: "还没有保存的内容" })).resolves.toBeNull();
    expect((await client.query("select id from relationship_pending_sources")).rows).toHaveLength(0);
    expect((await client.query("select status from messages where client_message_id='assistant-g1'")).rows[0]).toMatchObject({ status: "streaming" });
  });

  it("commits an explicit user boundary in the same completion transaction", async () => {
    const generation = await claim("g-boundary");
    await repository.saveReplyPrefix!({ userId, conversationId, generationId: "g-boundary", prefix: "Entiendo." });
    await expect(repository.finishReplyGeneration!({
      userId, conversationId, generationId: "g-boundary", content: "Entiendo.",
      relationshipCandidates: [{ kind: "explicit_friend_boundary", certainty: "explicit", sourceRole: "user", sourceMessageIds: [generation.userMessages[0]!.id], boundary: { scope: "romance", target: "all" } }],
    })).resolves.toMatchObject({ status: "completed" });
    expect((await client.query<{ event_kind: string; sequence: number }>("select event_kind,sequence from relationship_events")).rows).toEqual([{ event_kind: "explicit_friend_boundary", sequence: 1 }]);
    expect((await client.query<{ scope: string; target: string }>("select scope,target from relationship_boundaries")).rows).toEqual([{ scope: "romance", target: "all" }]);
    expect((await client.query("select status from messages where client_message_id='assistant-g-boundary'")).rows[0]).toMatchObject({ status: "completed" });
  });

  it("commits explicit positive user evidence without inventing a boundary", async () => {
    const generation = await claim("g-positive");
    await repository.saveReplyPrefix!({ userId, conversationId, generationId: "g-positive", prefix: "Me alegra." });
    await expect(repository.finishReplyGeneration!({
      userId, conversationId, generationId: "g-positive", content: "Me alegra.",
      relationshipCandidates: [{ kind: "mutual_conversation_welcome", certainty: "explicit", sourceRole: "user", sourceMessageIds: [generation.userMessages[0]!.id] }],
    })).resolves.toMatchObject({ status: "completed" });
    expect((await client.query<{ event_kind: string; certainty: string }>("select event_kind,certainty from relationship_events")).rows)
      .toEqual([{ event_kind: "mutual_conversation_welcome", certainty: "explicit" }]);
    expect((await client.query("select id from relationship_boundaries")).rows).toHaveLength(0);
    await expect(readRelationshipConversationContext(database, { userId, identityId })).resolves.toMatchObject({ relationshipStage: "new_contact", proactiveAllowed: true });
  });

  it("replays independent anchor, welcome, and return turns into familiarity", async () => {
    const turns: readonly (readonly [string, "voluntary_personal_anchor" | "mutual_conversation_welcome" | "user_continuity_return"])[] = [
      ["g-anchor", "voluntary_personal_anchor" as const],
      ["g-welcome", "mutual_conversation_welcome" as const],
      ["g-return", "user_continuity_return" as const],
    ];
    for (const [generationId, kind] of turns) {
      const generation = await claim(generationId);
      await repository.saveReplyPrefix!({ userId, conversationId, generationId, prefix: "Vale." });
      await repository.finishReplyGeneration!({ userId, conversationId, generationId, content: "Vale.", relationshipCandidates: [{ kind, certainty: kind === "voluntary_personal_anchor" ? "supported" : "explicit", sourceRole: "user", sourceMessageIds: [generation.userMessages[0]!.id] }] });
    }
    await expect(readRelationshipConversationContext(database, { userId, identityId })).resolves.toMatchObject({ relationshipStage: "familiar" });
    const positive = await claim("g-positive-exchange");
    await repository.saveReplyPrefix!({ userId, conversationId, generationId: "g-positive-exchange", prefix: "Qué bien." });
    await repository.finishReplyGeneration!({
      userId, conversationId, generationId: "g-positive-exchange", content: "Qué bien.",
      relationshipCandidates: [{ kind: "shared_positive_exchange", certainty: "explicit", sourceRole: "user", sourceMessageIds: [positive.userMessages[0]!.id] }],
    });
    const interest = await claim("g-interest");
    await repository.saveReplyPrefix!({ userId, conversationId, generationId: "g-interest", prefix: "Me gustas." });
    await repository.finishReplyGeneration!({
      userId, conversationId, generationId: "g-interest", content: "Me gustas.",
      relationshipCandidates: [{ kind: "character_interest_signal", certainty: "explicit", sourceRole: "assistant", sourceMessageIds: [interest.assistant.id] }],
    });
    expect((await client.query<{ event_kind: string }>("select event_kind from relationship_events where event_kind='character_interest_signal'")).rows)
      .toEqual([{ event_kind: "character_interest_signal" }]);
    await expect(readRelationshipConversationContext(database, { userId, identityId })).resolves.toMatchObject({ characterProposal: "interest_expressed" });
    const openness = await claim("g-openness");
    await repository.saveReplyPrefix!({ userId, conversationId, generationId: "g-openness", prefix: "Entiendo." });
    await repository.finishReplyGeneration!({
      userId, conversationId, generationId: "g-openness", content: "Entiendo.",
      relationshipCandidates: [{ kind: "user_romantic_declaration", certainty: "explicit", sourceRole: "user", sourceMessageIds: [openness.userMessages[0]!.id] }],
    });
    const afterOpen = await claim("g-positive-after-open");
    await repository.saveReplyPrefix!({ userId, conversationId, generationId: "g-positive-after-open", prefix: "Qué bonito." });
    await repository.finishReplyGeneration!({
      userId, conversationId, generationId: "g-positive-after-open", content: "Qué bonito.",
      relationshipCandidates: [{ kind: "shared_positive_exchange", certainty: "explicit", sourceRole: "user", sourceMessageIds: [afterOpen.userMessages[0]!.id] }],
    });
    const proposal = await claim("g-proposal");
    await repository.saveReplyPrefix!({ userId, conversationId, generationId: "g-proposal", prefix: "Quiero que seamos algo más." });
    await repository.finishReplyGeneration!({
      userId, conversationId, generationId: "g-proposal", content: "Quiero que seamos algo más.",
      relationshipCandidates: [{ kind: "character_relationship_proposal", certainty: "explicit", sourceRole: "assistant", sourceMessageIds: [proposal.assistant.id] }],
    });
    expect((await client.query<{ event_kind: string }>("select event_kind from relationship_events where event_kind='character_relationship_proposal'")).rows)
      .toEqual([{ event_kind: "character_relationship_proposal" }]);
    await expect(readRelationshipConversationContext(database, { userId, identityId })).resolves.toMatchObject({ characterProposal: "confirmation_pending", userRomanticIntent: "open" });
    const confirmation = await claim("g-confirmation");
    await repository.saveReplyPrefix!({ userId, conversationId, generationId: "g-confirmation", prefix: "Sí, quiero que seamos algo." });
    await repository.finishReplyGeneration!({
      userId, conversationId, generationId: "g-confirmation", content: "Sí, quiero que seamos algo.",
      relationshipCandidates: [{ kind: "explicit_romantic_confirmation", certainty: "explicit", sourceRole: "user", sourceMessageIds: [confirmation.userMessages[0]!.id], relatedSourceMessageIds: ["client-supplied-forbidden-id"] }],
    });
    expect((await client.query<{ event_kind: string; payload: { relatedSourceMessageIds?: string[] } }>("select event_kind,payload from relationship_events where event_kind='explicit_romantic_confirmation'")).rows)
      .toHaveLength(1);
    await expect(readRelationshipConversationContext(database, { userId, identityId })).resolves.toMatchObject({ characterProposal: "confirmed", userRomanticIntent: "confirmed" });
    expect(await tombstoneRelationshipSourcesForMessage(database, { userMessageId: proposal.assistant.id })).toBe(1);
    await expect(readRelationshipConversationContext(database, { userId, identityId })).resolves.toMatchObject({ characterProposal: "interest_expressed", userRomanticIntent: "open" });
  });
});
