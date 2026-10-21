// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  commitMemories,
  createDrizzleMemoryRepository,
  deleteMemoriesForSourceMessage,
  type MemoryCandidate,
} from "@/src/modules/memory";
import * as schema from "@/src/shared/db/schema";

const userA = "00000000-0000-4000-8000-000000000051";
const userB = "00000000-0000-4000-8000-000000000052";
const luciaId = "10000000-0000-4000-8000-000000000051";
const mateoId = "10000000-0000-4000-8000-000000000052";
const luciaIdentityId = "40000000-0000-4000-8000-000000000051";
const mateoIdentityId = "40000000-0000-4000-8000-000000000052";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
}

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    candidateId: "candidate-db-1",
    userId: userA,
    characterKey: "lucia",
    characterVersion: 1,
    conversationId: "20000000-0000-4000-8000-000000000051",
    sourceMessageId: null,
    factKey: "location.current",
    category: "location",
    content: "Madrid",
    confidence: 0.95,
    sensitivity: "sensitive",
    shareScope: "private",
    ...overrides,
  };
}

describe("memory persistence and sharing", () => {
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
    // The memory rows themselves are user state, so slice 2 reads and writes
    // them through `identity_id`; 0045 is the migration that added it.
    for (const name of ["0000_big_phalanx.sql", "0001_auth_rls.sql", "0002_content_import_registry.sql", "0003_chunky_black_knight.sql", "0004_calm_iron_monger.sql", "0005_kind_character_network.sql", "0016_proactive_messages.sql", "0017_sudden_betty_brant.sql", "0045_lumpy_medusa.sql"]) await client.exec(await migration(name));
    database = drizzle(client, { schema });
    await client.exec(`insert into auth.users (id, email) values ('${userA}', 'memory-a@example.test'), ('${userB}', 'memory-b@example.test');`);
    await database.insert(schema.characters).values([
      { id: luciaId, stableKey: "lucia", displayName: "Lucía", homeLocation: "Madrid", profile: {}, characterVersion: 1, status: "published" },
      { id: mateoId, stableKey: "mateo", displayName: "Mateo", homeLocation: "Valencia", profile: {}, characterVersion: 1, status: "published" },
    ]);
    await database.insert(schema.characterIdentities).values([
      { id: luciaIdentityId, stableKey: "lucia", currentCharacterId: luciaId },
      { id: mateoIdentityId, stableKey: "mateo", currentCharacterId: mateoId },
    ]);
    await database.insert(schema.conversations).values({
      id: "20000000-0000-4000-8000-000000000051",
      userId: userA,
      characterId: luciaId,
      identityId: luciaIdentityId,
    });
    await database.insert(schema.conversations).values({
      id: "20000000-0000-4000-8000-000000000052",
      userId: userB,
      characterId: luciaId,
      identityId: luciaIdentityId,
    });
  });

  afterEach(async () => { await client.close(); });

  it("deduplicates equal facts and records contradictions without replacing the old value", async () => {
    const repository = createDrizzleMemoryRepository(database);
    const first = await commitMemories({ repository, completed: true, candidates: [candidate()] });
    const duplicate = await commitMemories({ repository, completed: true, candidates: [candidate()] });
    const conflict = await commitMemories({ repository, completed: true, candidates: [candidate({ candidateId: "candidate-db-2", content: "Barcelona" })] });
    expect(first[0]?.result).toBe("inserted");
    expect(duplicate[0]?.result).toBe("duplicate");
    expect(conflict[0]?.result).toBe("conflict");
    const memories = await repository.listMemories(userA, "lucia");
    expect(memories.map((memory) => [memory.content, memory.status])).toEqual([["Madrid", "candidate"], ["Barcelona", "conflict"]]);
  });

  it("keeps memories private until an explicit target-character permission and isolates users", async () => {
    const repository = createDrizzleMemoryRepository(database);
    const [inserted] = await commitMemories({ repository, completed: true, candidates: [candidate()] });
    await commitMemories({ repository, completed: true, candidates: [candidate({ userId: userB, candidateId: "candidate-db-user-b", conversationId: "20000000-0000-4000-8000-000000000052", content: "Valencia" })] });
    const memoryId = inserted?.memory?.id;
    expect(memoryId).toBeTruthy();
    expect((await repository.listAllMemories(userA)).map((memory) => memory.content)).toEqual(["Madrid"]);
    expect((await repository.listAllMemories(userB)).map((memory) => memory.content)).toEqual(["Valencia"]);
    await client.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userA}', false);`);
    const visibleToUserA = await database.select({ userId: schema.relationshipMemories.userId }).from(schema.relationshipMemories);
    await client.exec("reset role;");
    expect(visibleToUserA.map((row) => row.userId)).toEqual([userA]);
    expect(await repository.listReadableMemories(userA, "mateo")).toHaveLength(0);
    await repository.grantPermission(userA, memoryId!, "mateo");
    expect((await repository.listReadableMemories(userA, "mateo")).map((memory) => memory.content)).toEqual(["Madrid"]);
    await repository.revokePermission(userA, memoryId!, "mateo");
    expect(await repository.listReadableMemories(userA, "mateo")).toHaveLength(0);
    expect(await repository.listReadableMemories(userB, "mateo")).toHaveLength(0);
    expect(await repository.deleteMemory(userB, memoryId!)).toBe(false);
    expect(await repository.deleteMemory(userA, memoryId!)).toBe(true);
    expect(await database.select().from(schema.memorySharingPermissions).where(eq(schema.memorySharingPermissions.memoryId, memoryId!))).toHaveLength(0);
    expect(await repository.listMemories(userA, "lucia")).toHaveLength(0);
  });

  it("deletes a memory by source message before the source message is removed", async () => {
    const sourceMessageId = "20000000-0000-4000-8000-000000000053";
    // This fixture intentionally uses the legacy migration set below, which
    // predates the later `messages.source_type` column. Insert only columns
    // present in that schema so the regression remains focused on the memory
    // foreign-key lifecycle rather than migration drift.
    await client.exec(`insert into messages (id, user_id, conversation_id, character_id, identity_id, client_message_id, role, status, content, completed_at)
      values ('${sourceMessageId}', '${userA}', '20000000-0000-4000-8000-000000000051', '${luciaId}', '${luciaIdentityId}', 'memory-source-message', 'user', 'completed', '这是产生关系记忆的消息', now())`);

    const repository = createDrizzleMemoryRepository(database);
    const [inserted] = await commitMemories({
      repository,
      completed: true,
      candidates: [candidate({
        candidateId: "candidate-db-source-message",
        sourceMessageId,
      })],
    });
    expect(inserted?.memory?.sourceMessageId).toBe(sourceMessageId);

    await expect(deleteMemoriesForSourceMessage(repository, userA, sourceMessageId)).resolves.toBe(1);
    expect(await database
      .select()
      .from(schema.relationshipMemories)
      .where(eq(schema.relationshipMemories.sourceMessageId, sourceMessageId))).toHaveLength(0);

    await database.delete(schema.messages).where(eq(schema.messages.id, sourceMessageId));
  });
});
