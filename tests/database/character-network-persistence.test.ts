// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDrizzleIntroductionRepository,
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
    for (const name of ["0000_big_phalanx.sql", "0001_auth_rls.sql", "0002_content_import_registry.sql", "0003_chunky_black_knight.sql", "0004_calm_iron_monger.sql", "0005_kind_character_network.sql"]) {
      await client.exec(await migration(name));
    }
    database = drizzle(client, { schema });
    await client.exec(`insert into auth.users (id, email) values ('${userId}', 'network@example.test');`);
    await database.insert(schema.characters).values([
      { id: luciaId, stableKey: "lucia", displayName: "Lucía", homeLocation: "Madrid", profile: {}, characterVersion: 1, status: "draft" },
      { id: mateoId, stableKey: "mateo", displayName: "Mateo", homeLocation: "Valencia", profile: {}, characterVersion: 1, status: "draft" },
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
});
