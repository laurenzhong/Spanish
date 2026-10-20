// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzleConversationRepository, listConversationHistory } from "@/src/modules/conversation";
import * as schema from "@/src/shared/db/schema";
import type { PendingConversationMessage } from "@/src/modules/conversation/repositories/conversation-repository";

const userId = "00000000-0000-4000-8000-000000000071";
const otherUser = "00000000-0000-4000-8000-000000000072";
const characterId = "10000000-0000-4000-8000-000000000071";
const identityId = "20000000-0000-4000-8000-000000000071";

describe("durable reply generations", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let repository: ReturnType<typeof createDrizzleConversationRepository>;
  let conversationId: string;
  beforeEach(async () => {
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;");
    for (const file of ["0000_big_phalanx.sql", "0003_chunky_black_knight.sql", "0005_kind_character_network.sql", "0013_smart_stick.sql", "0016_proactive_messages.sql", "0017_sudden_betty_brant.sql", "0018_dusty_sue_storm.sql", "0040_happy_wolverine.sql", "0045_lumpy_medusa.sql", "0047_conversation_reply_sources.sql"]) {
      await client.exec((await readFile(path.join(process.cwd(), "drizzle", file), "utf8")).replaceAll("--> statement-breakpoint", ""));
    }
    database = drizzle(client, { schema });
    await client.exec(`insert into profiles (id) values ('${userId}'), ('${otherUser}')`);
    await database.insert(schema.characters).values({ id: characterId, stableKey: "lucia", displayName: "Lucía", homeLocation: "Madrid", profile: {}, status: "published" });
    await database.insert(schema.characterIdentities).values({ id: identityId, stableKey: "lucia", currentCharacterId: characterId });
    repository = createDrizzleConversationRepository(database);
    conversationId = await repository.getOrCreateConversation(userId, "lucia", 1);
  });
  afterEach(async () => { await client.close(); });
  function claim(generationId: string, messages: readonly PendingConversationMessage[] = [{ clientMessageId: "u1", text: "Me gusta la fotografía." }], supersedes?: { generationId: string; visibleBubbleCount: number }) {
    return repository.claimReplyGeneration!({ userId, conversationId, characterKey: "lucia", generationId, messageId: randomUUID(), messages, supersedes });
  }
  function scope(generationId: string) { return { userId, conversationId, generationId }; }

  it("claims a batch atomically, preserves each user turn, and reuses an in-progress generation", async () => {
    const batch = [{ clientMessageId: "u1", text: "Me gusta la fotografía." }, { clientMessageId: "u2", text: "He comprado un libro." }];
    const first = await claim("g1", batch);
    expect(first.status).toBe("claimed");
    expect(first.userMessages.map((message) => message.content)).toEqual(batch.map((message) => message.text));
    expect((await claim("g1", batch)).status).toBe("in-progress");
    expect(await database.select().from(schema.messages)).toHaveLength(3);
    await expect(claim("g2", [{ clientMessageId: "u-new", text: "No debe escribirse." }, { clientMessageId: "u1", text: "Texto cambiado" }])).rejects.toThrow("MESSAGE_CONFLICT");
    expect(await database.select().from(schema.messages)).toHaveLength(3);
    await expect(claim("g2", [{ clientMessageId: "u1", text: "Me gusta la fotografía.", assistance: "translation" }])).rejects.toThrow("MESSAGE_CONFLICT");
  });

  it("saves only growing complete prefixes, cancels superseded generations, and cannot revive them", async () => {
    await claim("g1");
    expect(await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "Primera." })).toBe(true);
    expect(await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "Cambiada." })).toBe(false);
    expect(await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "Primera.\n\nSegunda." })).toBe(true);
    await claim("g2", [{ clientMessageId: "u2", text: "Otra cosa." }], { generationId: "g1", visibleBubbleCount: 1 });
    expect(await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "Primera.\n\nTercera." })).toBe(false);
    expect(await repository.finishReplyGeneration!({ ...scope("g1"), content: "Primera." })).toBeNull();
    const old = await repository.findAssistantMessage(userId, conversationId, "assistant-g1");
    expect(old).toMatchObject({ status: "cancelled", content: "Primera." });
    const history = await listConversationHistory(repository, userId, "lucia");
    expect(history.filter((row) => row.role === "character")).toEqual([expect.objectContaining({ text: "Primera.", status: "cancelled" })]);
  });

  it("leaves a cancellation tombstone when the superseded request has not arrived yet", async () => {
    await claim("new", [{ clientMessageId: "u2", text: "También compré un libro." }], { generationId: "late", visibleBubbleCount: 0 });
    expect((await claim("late")).status).toBe("cancelled");
    expect(await repository.saveReplyPrefix!({ ...scope("new"), prefix: "¿Un libro de fotografía o de otra cosa?" })).toBe(true);
    expect((await repository.listMessages(userId, "lucia")).filter((row) => row.role === "character")).toHaveLength(1);
  });

  it("does not let an older request reclaim the thread when three generations arrive out of order", async () => {
    const batch = [{ clientMessageId: "u1", text: "Primero." }, { clientMessageId: "u2", text: "Segundo." }, { clientMessageId: "u3", text: "Tercero." }];
    await claim("g3", batch, { generationId: "g2", visibleBubbleCount: 0 });
    expect((await claim("g1", batch.slice(0, 1))).status).toBe("cancelled");
    expect((await claim("g2", batch.slice(0, 2), { generationId: "g1", visibleBubbleCount: 0 })).status).toBe("cancelled");
    expect(await repository.saveReplyPrefix!({ ...scope("g3"), prefix: "Respuesta vigente." })).toBe(true);
    expect((await repository.listMessages(userId, "lucia")).filter((row) => row.role === "character")).toHaveLength(1);
  });

  it("protects owner and completed content and finalizes exactly once", async () => {
    await claim("g1");
    expect(await repository.saveReplyPrefix!({ ...scope("g1"), userId: otherUser, prefix: "Private" })).toBe(false);
    await expect(repository.claimReplyGeneration!({ userId: otherUser, conversationId, characterKey: "lucia", generationId: "bad", messageId: randomUUID(), messages: [{ clientMessageId: "x", text: "Private" }] })).rejects.toThrow("CONVERSATION_UNAVAILABLE");
    await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "Primera.\n\nSegunda." });
    expect(await repository.finishReplyGeneration!({ ...scope("g1"), content: "Different" })).toBeNull();
    expect(await repository.finishReplyGeneration!({ ...scope("g1"), content: "Primera.\n\nSegunda." })).toMatchObject({ status: "completed" });
    expect(await repository.finishReplyGeneration!({ ...scope("g1"), content: "Primera.\n\nSegunda." })).toBeNull();
    expect((await claim("g1")).status).toBe("completed");
    await claim("g2", [{ clientMessageId: "u2", text: "Hola." }], { generationId: "g1", visibleBubbleCount: 0 });
    expect(await repository.findAssistantMessage(userId, conversationId, "assistant-g1")).toMatchObject({ content: "Primera.\n\nSegunda.", status: "completed" });
  });

  it("rejects writes after parent withdrawal and keeps empty cancelled drafts out of history", async () => {
    const first = await claim("g1");
    await database.update(schema.messages).set({ status: "withdrawn" }).where(eq(schema.messages.id, first.userMessages[0].id));
    expect(await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "No debería verse." })).toBe(false);
    expect(await repository.finishReplyGeneration!({ ...scope("g1"), content: "" })).toBeNull();
    await repository.cancelReplyGeneration!(scope("g1"));
    expect((await listConversationHistory(repository, userId, "lucia")).filter((row) => row.role === "character")).toHaveLength(0);
  });

  it("does not emit from a batch when an earlier unanswered user message was withdrawn", async () => {
    const first = await claim("g1", [{ clientMessageId: "earlier", text: "Primer tema." }, { clientMessageId: "latest", text: "Segundo tema." }]);
    const userMessageIds = first.userMessages.map((row) => row.id);
    await database.update(schema.messages).set({ status: "withdrawn" }).where(eq(schema.messages.id, first.userMessages[0].id));
    expect(await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "Contenido privado", userMessageIds })).toBe(false);
    expect(await repository.finishReplyGeneration!({ ...scope("g1"), content: "Contenido privado", userMessageIds })).toBeNull();
  });

  it("binds the complete ordered batch to the generation instead of accepting reduced or reordered retries", async () => {
    const batch = [{ clientMessageId: "u1", text: "Primero." }, { clientMessageId: "u2", text: "Segundo." }, { clientMessageId: "u3", text: "Tercero." }];
    await claim("g1", batch);
    await expect(claim("g1", batch.slice(1))).rejects.toThrow("MESSAGE_CONFLICT");
    await expect(claim("g1", [batch[1], batch[0], batch[2]])).rejects.toThrow("MESSAGE_CONFLICT");
    expect((await claim("g1", batch)).status).toBe("in-progress");
  });

  it.each(["completed", "cancelled"] as const)("removes only linked %s assistant content when an earlier source is withdrawn", async (status) => {
    const first = await claim("g1", [{ clientMessageId: "u1", text: "Tema privado." }, { clientMessageId: "u2", text: "Otra cosa." }]);
    await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "Contenido privado." });
    if (status === "completed") await repository.finishReplyGeneration!({ ...scope("g1"), content: "Contenido privado." });
    else await repository.cancelReplyGeneration!(scope("g1"));
    await claim("g2", [{ clientMessageId: "u3", text: "Nuevo tema." }]);
    await repository.saveReplyPrefix!({ ...scope("g2"), prefix: "Respuesta independiente." });
    await repository.finishReplyGeneration!({ ...scope("g2"), content: "Respuesta independiente." });
    expect(await repository.withdrawMessage(userId, "lucia", first.userMessages[0].id)).toBe(true);
    expect(await repository.findAssistantMessage(userId, conversationId, "assistant-g1")).toMatchObject({ status: "cancelled", content: "", sourceType: "generation_tombstone" });
    expect(await repository.findAssistantMessage(userId, conversationId, "assistant-g2")).toMatchObject({ content: "Respuesta independiente." });
    expect((await listConversationHistory(repository, userId, "lucia")).some((row) => row.text.includes("Contenido privado"))).toBe(false);
    expect(await repository.searchMessages(userId, "Contenido privado")).toHaveLength(0);
    expect((await repository.listConversations(userId))[0].lastMessage?.content).toBe("Respuesta independiente.");
    expect(await repository.finishReplyGeneration!({ ...scope("g1"), content: "Contenido privado." })).toBeNull();
  });

  it("uses durable source membership to reject completion after earlier-source withdrawal without live IDs", async () => {
    const first = await claim("g1", [{ clientMessageId: "u1", text: "Tema privado." }, { clientMessageId: "u2", text: "Otra cosa." }]);
    await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "Contenido privado." });
    await database.update(schema.messages).set({ status: "withdrawn" }).where(eq(schema.messages.id, first.userMessages[0].id));
    expect(await repository.finishReplyGeneration!({ ...scope("g1"), content: "Contenido privado." })).toBeNull();
    expect(await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "Contenido privado.\n\nOtro dato." })).toBe(false);
  });

  it("deletes the assistant that depends on an earlier batch source", async () => {
    const first = await claim("g1", [{ clientMessageId: "u1", text: "Tema privado." }, { clientMessageId: "u2", text: "Otra cosa." }]);
    await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "Contenido privado." });
    expect(await repository.deleteMessage(userId, "lucia", first.userMessages[0].id)).toBe(true);
    expect(await repository.findAssistantMessage(userId, conversationId, "assistant-g1")).toMatchObject({ status: "cancelled", content: "", sourceType: "generation_tombstone" });
    expect((await repository.listMessages(userId, "lucia")).filter((row) => row.role === "user")).toHaveLength(1);
    expect((await claim("g1", [{ clientMessageId: "u2", text: "Otra cosa." }])).status).toBe("cancelled");
  });

  it("isolates generation names and supersedes across owners, including colliding message IDs", async () => {
    const first = await claim("same-generation");
    const otherConversation = await repository.getOrCreateConversation(otherUser, "lucia", 1);
    const other = await repository.claimReplyGeneration!({ userId: otherUser, conversationId: otherConversation, characterKey: "lucia", generationId: "same-generation", messageId: randomUUID(), messages: [{ clientMessageId: "u1", text: "Otro usuario." }], supersedes: { generationId: "g1", visibleBubbleCount: 0 } });
    expect(other.status).toBe("claimed");
    expect(await repository.saveReplyPrefix!({ ...scope("same-generation"), prefix: "Solo del propietario." })).toBe(true);
    await repository.claimReplyGeneration!({ userId: otherUser, conversationId: otherConversation, characterKey: "lucia", generationId: "foreign-only", messageId: randomUUID(), messages: [{ clientMessageId: "other-new", text: "Otra pregunta privada." }] });
    await claim("g2", [{ clientMessageId: "u2", text: "Otra cosa." }], { generationId: "foreign-only", visibleBubbleCount: 0 });
    expect(await repository.saveReplyPrefix!({ userId: otherUser, conversationId: otherConversation, generationId: "foreign-only", prefix: "Sigue vigente." })).toBe(true);
    await expect(repository.claimReplyGeneration!({ ...scope("collision"), characterKey: "lucia", messageId: other.assistant.id, messages: [{ clientMessageId: "must-rollback", text: "No se guarda." }] })).rejects.toThrow();
    expect((await repository.listMessages(userId, "lucia")).some((row) => row.clientMessageId === "must-rollback")).toBe(false);
    expect((await repository.findAssistantMessage(userId, conversationId, first.assistant.clientMessageId))?.content).toBe("Solo del propietario.");
  });

  it("can trim an already cancelled generation but late callbacks cannot revive it", async () => {
    await claim("g1");
    await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "Primera.\n\nSegunda." });
    await repository.cancelReplyGeneration!(scope("g1"));
    await claim("g2", [{ clientMessageId: "u2", text: "Otra cosa." }], { generationId: "g1", visibleBubbleCount: 1 });
    expect(await repository.findAssistantMessage(userId, conversationId, "assistant-g1")).toMatchObject({ status: "cancelled", content: "Primera." });
    expect(await repository.saveReplyPrefix!({ ...scope("g1"), prefix: "Primera.\n\nTercera." })).toBe(false);
    expect(await repository.finishReplyGeneration!({ ...scope("g1"), content: "Primera." })).toBeNull();
  });

  it("exposes source links only to their owner and rejects client writes and cross-owner provenance", async () => {
    const first = await claim("g1");
    const otherConversation = await repository.getOrCreateConversation(otherUser, "lucia", 1);
    const other = await repository.claimReplyGeneration!({ userId: otherUser, conversationId: otherConversation, characterKey: "lucia", generationId: "g2", messageId: randomUUID(), messages: [{ clientMessageId: "other", text: "Otro usuario." }] });
    await expect(database.insert(schema.conversationReplySources).values({ assistantMessageId: first.assistant.id, userMessageId: other.userMessages[0].id, userId, conversationId, position: 1 })).rejects.toMatchObject({ cause: expect.objectContaining({ message: "conversation_reply_source_scope_mismatch" }) });
    await client.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
    const visible = await client.query<{ user_id: string }>("select user_id from conversation_reply_sources");
    expect(visible.rows).toEqual([{ user_id: userId }]);
    for (const command of ["delete from conversation_reply_sources", "update conversation_reply_sources set position = 1", `insert into conversation_reply_sources values ('${first.assistant.id}', '${first.userMessages[0].id}', '${userId}', '${conversationId}', 0)`]) {
      await expect(client.exec(command)).rejects.toThrow("permission denied");
    }
    await client.exec("reset role; set role anon;");
    await expect(client.query("select * from conversation_reply_sources")).rejects.toThrow("permission denied");
    await client.exec("reset role;");
  });
});
