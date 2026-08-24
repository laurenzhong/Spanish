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
    for (const name of ["0000_big_phalanx.sql", "0001_auth_rls.sql", "0002_content_import_registry.sql", "0003_conversation_persistence.sql"]) await client.exec(await migration(name));
    database = drizzle(client, { schema });
    await client.exec(`insert into auth.users (id, email) values ('${userId}', 'conversation@example.test');`);
    await database.insert(schema.characters).values({ id: characterId, stableKey: "lucia", displayName: "Lucía", homeLocation: "Madrid", profile: {}, characterVersion: 1, status: "published" });
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
});
