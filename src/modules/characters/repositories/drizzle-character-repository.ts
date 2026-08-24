import { and, asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type { CharacterRepository, PersistedCanonFact, PersistedCharacter } from "./character-repository";

type CharacterDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

function toFact(row: typeof schema.characterCanonFacts.$inferSelect): PersistedCanonFact {
  return {
    factKey: row.factKey,
    value: row.value as PersistedCanonFact["value"],
    sensitivity: row.sensitivity,
    version: row.canonVersion,
    isActive: row.isActive,
  };
}

export function createDrizzleCharacterRepository<TResult extends PgQueryResultHKT>(
  database: CharacterDatabase<TResult>,
): CharacterRepository {
  return {
    async findByStableVersion(stableKey, version) {
      const [character] = await database
        .select()
        .from(schema.characters)
        .where(and(eq(schema.characters.stableKey, stableKey), eq(schema.characters.characterVersion, version)))
        .limit(1);
      if (!character) return null;
      const facts = await database
        .select()
        .from(schema.characterCanonFacts)
        .where(eq(schema.characterCanonFacts.characterId, character.id))
        .orderBy(asc(schema.characterCanonFacts.factKey), asc(schema.characterCanonFacts.canonVersion));
      const profile = character.profile as PersistedCharacter["profile"];
      return {
        id: character.id,
        stableKey: character.stableKey,
        version: character.characterVersion,
        status: character.status,
        displayName: character.displayName,
        avatarUrl: character.avatarUrl,
        homeLocation: character.homeLocation,
        profile,
        facts: facts.map(toFact),
      };
    },

    async insert({ character, profile }) {
      const [inserted] = await database
        .insert(schema.characters)
        .values({
          stableKey: character.stableKey,
          displayName: character.displayName,
          avatarUrl: character.avatarUrl ?? null,
          homeLocation: character.homeLocation,
          profile,
          characterVersion: character.version,
          status: character.status,
        })
        .returning();
      if (!inserted) throw new Error("CHARACTER_INSERT_FAILED");
      if (character.facts.length > 0) {
        await database.insert(schema.characterCanonFacts).values(
          character.facts.map((fact) => ({
            characterId: inserted.id,
            factKey: fact.factKey,
            value: fact.value,
            sensitivity: fact.sensitivity,
            canonVersion: fact.version,
            isActive: fact.isActive,
          })),
        );
      }
      return {
        id: inserted.id,
        stableKey: inserted.stableKey,
        version: inserted.characterVersion,
        status: inserted.status,
        displayName: inserted.displayName,
        avatarUrl: inserted.avatarUrl,
        homeLocation: inserted.homeLocation,
        profile,
        facts: character.facts.map(({ factKey, value, sensitivity, version, isActive }) => ({
          factKey,
          value,
          sensitivity,
          version,
          isActive,
        })),
      };
    },

    async transaction(work) {
      return database.transaction((transaction) => work(createDrizzleCharacterRepository(transaction)));
    },
  };
}
