// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDrizzleConversationRepository,
  persistCompletedAssistantMessage,
  persistUserMessage,
} from "@/src/modules/conversation";
import * as schema from "@/src/shared/db/schema";

const userId = "00000000-0000-4000-8000-000000000031";
const characterId = "10000000-0000-4000-8000-000000000031";
const draftCharacterId = "10000000-0000-4000-8000-000000000032";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
}

describe("conversation persistence", () => {
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
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    for (const name of ["0000_big_phalanx.sql", "0001_auth_rls.sql", "0002_content_import_registry.sql", "0003_chunky_black_knight.sql", "0013_smart_stick.sql", "0016_proactive_messages.sql", "0017_sudden_betty_brant.sql", "0018_dusty_sue_storm.sql", "0040_happy_wolverine.sql"]) await client.exec(await migration(name));
    database = drizzle(client, { schema });
    await client.exec(`insert into auth.users (id, email) values ('${userId}', 'conversation@example.test');`);
    await database.insert(schema.characters).values({ id: characterId, stableKey: "lucia", displayName: "Lucía", homeLocation: "Madrid", profile: {}, characterVersion: 1, status: "published" });
    await database.insert(schema.characters).values({ id: draftCharacterId, stableKey: "mateo", displayName: "Mateo", homeLocation: "Valencia", profile: {}, characterVersion: 1, status: "draft" });
  });

  afterEach(async () => { await client.close(); });

  it("creates one conversation and deduplicates the user message", async () => {
    const repository = createDrizzleConversationRepository(database);
    const conversationId = await repository.getOrCreateConversation(userId, "lucia", 1);
    const sameConversationId = await repository.getOrCreateConversation(userId, "lucia", 1);
    expect(sameConversationId).toBe(conversationId);
    const input = { userId, conversationId, characterKey: "lucia", clientMessageId: "client-1", generationId: "generation-1", content: "Hola" };
    await persistUserMessage(repository, input);
    await persistUserMessage(repository, input);
    const [{ count }] = await database.select({ count: sql<number>`count(*)` }).from(schema.messages).where(and(eq(schema.messages.userId, userId), eq(schema.messages.role, "user")));
    expect(Number(count)).toBe(1);
  });

  it("does not persist an assistant until completion, then deduplicates completion", async () => {
    const repository = createDrizzleConversationRepository(database);
    const conversationId = await repository.getOrCreateConversation(userId, "lucia", 1);
    const user = await persistUserMessage(repository, { userId, conversationId, characterKey: "lucia", clientMessageId: "client-2", generationId: "generation-2", content: "Hola" });
    const before = await repository.listMessages(userId, "lucia");
    expect(before).toHaveLength(1);
    const input = { userId, conversationId, characterKey: "lucia", messageId: "20000000-0000-4000-8000-000000000032", generationId: "generation-2", clientMessageId: "assistant-generation-2", content: "¡Hola!", replyToMessageId: user.id };
    await persistCompletedAssistantMessage(repository, input);
    await persistCompletedAssistantMessage(repository, input);
    const messages = await repository.listMessages(userId, "lucia");
    expect(messages.map((message) => message.role)).toEqual(["user", "character"]);
    expect(messages[1]?.status).toBe("completed");
  });

  it("rejects draft characters for new conversations and excludes them from discovery", async () => {
    const repository = createDrizzleConversationRepository(database);
    await expect(repository.getOrCreateConversation(userId, "mateo", 1)).rejects.toThrow("CHARACTER_UNAVAILABLE");
    await database.insert(schema.conversations).values({ userId, characterId: draftCharacterId });
    expect(await repository.listConversations(userId)).toHaveLength(0);
    expect(await repository.searchMessages(userId, "Mateo")).toHaveLength(0);
  });

  it("does not expose an assistant reply after its user turn is withdrawn", async () => {
    const repository = createDrizzleConversationRepository(database);
    const conversationId = await repository.getOrCreateConversation(userId, "lucia", 1);
    const user = await persistUserMessage(repository, {
      userId,
      conversationId,
      characterKey: "lucia",
      clientMessageId: "withdraw-parent",
      generationId: "withdraw-generation",
      content: "我的私密问题",
    });
    await persistCompletedAssistantMessage(repository, {
      userId,
      conversationId,
      characterKey: "lucia",
      messageId: "20000000-0000-4000-8000-000000000033",
      generationId: "withdraw-generation",
      clientMessageId: "withdraw-assistant",
      content: "不应再出现在搜索或联系人预览中的回复",
      replyToMessageId: user.id,
    });

    const before = await repository.listConversations(userId);
    expect(before[0]?.lastMessage?.content).toContain("不应再出现在");
    expect(before[0]?.unreadCount).toBe(1);
    expect(await repository.searchMessages(userId, "不应再出现在")).toHaveLength(1);

    await expect(repository.withdrawMessage(userId, "lucia", user.id)).resolves.toBe(true);

    const after = await repository.listConversations(userId);
    expect(after[0]?.lastMessage).toBeNull();
    expect(after[0]?.unreadCount).toBe(0);
    expect(await repository.searchMessages(userId, "不应再出现在")).toHaveLength(0);
  });

  it("deletes assistant replies together with a deleted user turn", async () => {
    const repository = createDrizzleConversationRepository(database);
    const conversationId = await repository.getOrCreateConversation(userId, "lucia", 1);
    const user = await persistUserMessage(repository, {
      userId,
      conversationId,
      characterKey: "lucia",
      clientMessageId: "delete-parent",
      generationId: "delete-generation",
      content: "需要彻底删除的问题",
    });
    await persistCompletedAssistantMessage(repository, {
      userId,
      conversationId,
      characterKey: "lucia",
      messageId: "20000000-0000-4000-8000-000000000034",
      generationId: "delete-generation",
      clientMessageId: "delete-assistant",
      content: "需要一起删除的回复",
      replyToMessageId: user.id,
    });

    await expect(repository.deleteMessage(userId, "lucia", user.id)).resolves.toBe(true);
    const remaining = await database.select().from(schema.messages).where(eq(schema.messages.conversationId, conversationId));
    expect(remaining).toHaveLength(0);
    await expect(repository.deleteMessage(userId, "lucia", user.id)).resolves.toBe(false);
  });
});
