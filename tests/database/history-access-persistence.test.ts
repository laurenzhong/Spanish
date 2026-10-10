// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterRuntimeDefinition } from "@/src/modules/characters";

/**
 * The checked-in runtime manifest publishes only Lucía, so with the real
 * manifest no non-Lucía key can reach the relationship half of the gate. This
 * stub publishes one extra fixture key - and nothing else - so the published
 * non-Lucía path can be exercised on real SQL. The publication checks
 * themselves (characters.status and the capability policy) and the merged
 * statement stay real; only the static capability manifest is stubbed.
 */
const manifestStub = vi.hoisted(() => ({ characterKey: "pablo", version: 1 }));

vi.mock("@/src/modules/characters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/modules/characters")>();
  const publishedNonLucia: CharacterRuntimeDefinition = {
    stableKey: manifestStub.characterKey,
    version: manifestStub.version,
    lifecycle: "published",
    policy: {
      conversation: "basic",
      proactiveMessages: false,
      romanticSubtext: false,
      introductions: true,
      persistentMemory: "private",
      maxRelationshipStage: "close_friend",
      voiceInput: false,
    },
  };
  return {
    ...actual,
    findCharacterRuntimeDefinition: (stableKey: string, version = 1) =>
      stableKey === publishedNonLucia.stableKey && version === publishedNonLucia.version
        ? publishedNonLucia
        : actual.findCharacterRuntimeDefinition(stableKey, version),
  };
});

import { createDrizzleIntroductionRepository } from "@/src/modules/character-network";
import { resolveHistoryAccess } from "@/src/modules/conversation/application/resolve-history-access";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const userId = "00000000-0000-4000-8000-000000000071";
const otherUserId = "00000000-0000-4000-8000-000000000072";
const luciaId = "10000000-0000-4000-8000-000000000071";
const pabloId = "10000000-0000-4000-8000-000000000072";
const mateoId = "10000000-0000-4000-8000-000000000073";
const inesId = "10000000-0000-4000-8000-000000000074";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
}

/**
 * The non-Lucía history gate used to resolve the character and then the
 * relationship in two sequential statements. It now issues one
 * characters LEFT JOIN character_relationships statement. These cases pin the
 * decision that statement has to keep producing: the publication gate, the
 * relationship row, and the absence of a relationship row.
 */
describe("conversation history access gate", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let statements: string[];

  async function relationshipStatus(characterKey: string, asUserId = userId) {
    const reader = createDrizzleIntroductionRepository(database).getRelationshipStatus;
    if (!reader) throw new Error("the introduction repository no longer exposes getRelationshipStatus");
    statements.length = 0;
    return reader(asUserId, characterKey, 1);
  }

  /**
   * resolveHistoryAccess declares the postgres-js database type, but it only
   * needs the shared PgDatabase surface. PGlite is the in-process Postgres the
   * other tests/database suites run against, so the cast keeps this suite on
   * real SQL instead of a query-builder double.
   */
  function accessDatabase() {
    return database as unknown as Database;
  }

  beforeEach(async () => {
    statements = [];
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
    database = drizzle(client, {
      schema,
      // Counting statements is the point of this suite: the gate must cost one
      // round trip, not two.
      logger: { logQuery: (query) => { statements.push(query); } },
    });
    await client.exec(`insert into auth.users (id, email) values ('${userId}', 'gate@example.test'), ('${otherUserId}', 'other@example.test');`);
    await database.insert(schema.characters).values([
      { id: luciaId, stableKey: "lucia", displayName: "Lucía", homeLocation: "Madrid", profile: {}, characterVersion: 1, status: "published" },
      { id: pabloId, stableKey: "pablo", displayName: "Pablo", homeLocation: "Sevilla", profile: {}, characterVersion: 1, status: "published" },
      { id: mateoId, stableKey: "mateo", displayName: "Mateo", homeLocation: "Valencia", profile: {}, characterVersion: 1, status: "published" },
      { id: inesId, stableKey: "ines", displayName: "Inés", homeLocation: "Barcelona", profile: {}, characterVersion: 1, status: "draft" },
    ]);
    await database.insert(schema.characterRelationships).values([
      { userId, characterId: luciaId, status: "active" },
      { userId, characterId: pabloId, status: "active" },
      { userId, characterId: mateoId, status: "active" },
      { userId, characterId: inesId, status: "active" },
    ]);
  });

  afterEach(async () => { await client.close(); });

  it("reads a published character and its relationship in a single statement", async () => {
    // The previous shape returned the same value, but only after a second
    // sequential round trip.
    await expect(relationshipStatus("lucia")).resolves.toBe("active");
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('"characters"');
    expect(statements[0]).toContain('"character_relationships"');
  });

  it("keeps an absent relationship row fail-closed instead of inventing one", async () => {
    // otherUserId has no relationship row at all. The left join yields the
    // character with a null relationship, which must stay null: the callers
    // read it as "not established", never as "no gate".
    await expect(relationshipStatus("lucia", otherUserId)).resolves.toBeNull();
    expect(statements).toHaveLength(1);
  });

  it("still reports a declined relationship", async () => {
    await database.update(schema.characterRelationships)
      .set({ status: "declined" })
      .where(and(
        eq(schema.characterRelationships.userId, userId),
        eq(schema.characterRelationships.characterId, luciaId),
      ));

    await expect(relationshipStatus("lucia")).resolves.toBe("declined");
  });

  it("still reports a pending relationship", async () => {
    await database.update(schema.characterRelationships)
      .set({ status: "pending" })
      .where(and(
        eq(schema.characterRelationships.userId, userId),
        eq(schema.characterRelationships.characterId, luciaId),
      ));

    await expect(relationshipStatus("lucia")).resolves.toBe("pending");
  });

  it("refuses a character that is published in the database but draft in the runtime manifest", async () => {
    // A relationship row exists and the database says published, so only the
    // manifest check can refuse this. The merged statement must not treat the
    // presence of a joined relationship as the whole gate.
    await expect(relationshipStatus("mateo")).resolves.toBeNull();
  });

  it("refuses a draft character even though the relationship row is active", async () => {
    await expect(relationshipStatus("ines")).resolves.toBeNull();
  });

  it("refuses a character that does not exist", async () => {
    await expect(relationshipStatus("nobody")).resolves.toBeNull();
    expect(statements).toHaveLength(1);
  });

  it("allows a published non-Lucía contact in a single statement", async () => {
    statements.length = 0;
    await expect(resolveHistoryAccess(accessDatabase(), userId, "pablo")).resolves.toEqual({
      readOnly: false,
      canSend: true,
      contactStatus: "active",
    });
    expect(statements).toHaveLength(1);
  });

  it("refuses a published non-Lucía contact whose relationship row is absent", async () => {
    // The character is published, so the gate really has to answer "is there a
    // relationship". A missing left-joined row must refuse, not open the chat.
    statements.length = 0;
    await expect(resolveHistoryAccess(accessDatabase(), otherUserId, "pablo")).resolves.toEqual({
      readOnly: true,
      canSend: false,
      contactStatus: "pending",
    });
    expect(statements).toHaveLength(1);
  });

  it("refuses a non-Lucía history read while the character is still draft", async () => {
    statements.length = 0;
    await expect(resolveHistoryAccess(accessDatabase(), userId, "mateo")).resolves.toEqual({
      readOnly: true,
      canSend: false,
      contactStatus: "pending",
    });
    expect(statements).toHaveLength(1);
  });

  it("refuses a non-Lucía history read for a character that does not exist", async () => {
    statements.length = 0;
    await expect(resolveHistoryAccess(accessDatabase(), userId, "nobody")).resolves.toEqual({
      readOnly: true,
      canSend: false,
      contactStatus: "pending",
    });
    expect(statements).toHaveLength(1);
  });
});
