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

function toPersistedCharacter(
  row: typeof schema.characters.$inferSelect,
  facts: readonly (typeof schema.characterCanonFacts.$inferSelect)[],
): PersistedCharacter {
  return {
    id: row.id,
    stableKey: row.stableKey,
    version: row.characterVersion,
    status: row.status,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    homeLocation: row.homeLocation,
    profile: row.profile as PersistedCharacter["profile"],
    facts: facts.map(toFact),
  };
}

export function createDrizzleCharacterRepository<TResult extends PgQueryResultHKT>(
  database: CharacterDatabase<TResult>,
): CharacterRepository {
  return {
    async findByStableVersion(stableKey, version) {
      // The character row and its canon facts are read in one statement. This
      // lookup gates every conversation open as well as publish/import, and a
      // remote database bills the request in round trips rather than query
      // cost. The left join preserves a character that has no facts yet.
      const rows = await database
        .select({ character: schema.characters, fact: schema.characterCanonFacts })
        .from(schema.characters)
        .leftJoin(
          schema.characterCanonFacts,
          eq(schema.characterCanonFacts.characterId, schema.characters.id),
        )
        .where(and(eq(schema.characters.stableKey, stableKey), eq(schema.characters.characterVersion, version)))
        .orderBy(asc(schema.characterCanonFacts.factKey), asc(schema.characterCanonFacts.canonVersion));
      const character = rows[0]?.character;
      if (!character) return null;
      const facts = rows.flatMap((row) => (row.fact ? [row.fact] : []));
      return toPersistedCharacter(character, facts);
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

    async replaceDraft({ character, profile }) {
      const [current] = await database
        .select()
        .from(schema.characters)
        .where(and(eq(schema.characters.stableKey, character.stableKey), eq(schema.characters.characterVersion, character.version)))
        .limit(1);
      if (!current) throw new Error("CHARACTER_UNAVAILABLE");
      if (current.status !== "draft") throw new Error("CHARACTER_STATUS_NOT_EDITABLE");
      const [updated] = await database
        .update(schema.characters)
        .set({
          displayName: character.displayName,
          avatarUrl: character.avatarUrl ?? null,
          homeLocation: character.homeLocation,
          profile,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.characters.id, current.id),
          eq(schema.characters.status, "draft"),
        ))
        .returning();
      if (!updated) throw new Error("CHARACTER_DRAFT_CONFLICT");
      await database.delete(schema.characterCanonFacts).where(eq(schema.characterCanonFacts.characterId, current.id));
      if (character.facts.length > 0) {
        await database.insert(schema.characterCanonFacts).values(character.facts.map((fact) => ({
          characterId: current.id,
          factKey: fact.factKey,
          value: fact.value,
          sensitivity: fact.sensitivity,
          canonVersion: fact.version,
          isActive: fact.isActive,
        })));
      }
      const facts = await database
        .select()
        .from(schema.characterCanonFacts)
        .where(eq(schema.characterCanonFacts.characterId, current.id))
        .orderBy(asc(schema.characterCanonFacts.factKey), asc(schema.characterCanonFacts.canonVersion));
      return toPersistedCharacter(updated, facts);
    },

    async publish({ stableKey, version, reviews }) {
      const [current] = await database
        .select()
        .from(schema.characters)
        .where(and(eq(schema.characters.stableKey, stableKey), eq(schema.characters.characterVersion, version)))
        .limit(1);
      if (!current) throw new Error("CHARACTER_UNAVAILABLE");
      if (current.status === "published") {
        // Idempotent repeat: the revision is already the one publish serves, so
        // neither the row nor the identity pointer moves again. A repeated
        // publish must not be able to pull the pointer back onto an old
        // revision.
        const facts = await database
          .select()
          .from(schema.characterCanonFacts)
          .where(eq(schema.characterCanonFacts.characterId, current.id))
          .orderBy(asc(schema.characterCanonFacts.factKey), asc(schema.characterCanonFacts.canonVersion));
        return toPersistedCharacter(current, facts);
      }
      if (current.status !== "draft" && current.status !== "approved") {
        throw new Error("CHARACTER_STATUS_NOT_PUBLISHABLE");
      }
      const now = new Date();
      const [updated] = await database
        .update(schema.characters)
        .set({ status: "published", updatedAt: now })
        .where(and(
          eq(schema.characters.id, current.id),
          eq(schema.characters.status, current.status),
        ))
        .returning();
      if (!updated) throw new Error("CHARACTER_PUBLISH_CONFLICT");
      if (reviews.length > 0) {
        await database.insert(schema.contentReviews).values(reviews.map((review) => ({
          entityType: "character",
          entityId: current.id,
          locale: review.locale,
          status: "approved" as const,
          reviewerReference: review.reviewerReference,
          notes: review.notes,
          reviewedAt: review.reviewedAt,
        })));
      }
      // ADR 0014 / slice 3: publishing owns the identity pointer, and the write
      // happens here — next to the status flip and the review rows — so that all
      // of it commits or rolls back as one unit. Reached only after the revision
      // above went from draft/approved to published, so the pointer can never
      // land on an unpublished revision. One statement covers both cases: a
      // character whose `stable_key` has no identity yet gets one (stable_key =
      // the revision's stable key, pointer = this revision), and an existing one
      // only has its pointer moved. No user-state table is touched: that is the
      // entire point of the ADR.
      await database
        .insert(schema.characterIdentities)
        .values({ stableKey: updated.stableKey, currentCharacterId: updated.id, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.characterIdentities.stableKey,
          set: { currentCharacterId: updated.id, updatedAt: now },
        });
      const facts = await database
        .select()
        .from(schema.characterCanonFacts)
        .where(eq(schema.characterCanonFacts.characterId, updated.id))
        .orderBy(asc(schema.characterCanonFacts.factKey), asc(schema.characterCanonFacts.canonVersion));
      return toPersistedCharacter(updated, facts);
    },

    async transaction(work) {
      return database.transaction((transaction) => work(createDrizzleCharacterRepository(transaction)));
    },
  };
}
