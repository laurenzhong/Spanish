import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type {
  LuciaContactRecord,
  LuciaContactRepository,
  LuciaContactStatus,
} from "./lucia-contact-repository";

type NetworkDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

const source = {
  kind: "cultural-event" as const,
  city: "Madrid" as const,
  topic: "urban-photography" as const,
};

async function findLucia<TResult extends PgQueryResultHKT>(database: NetworkDatabase<TResult>) {
  const [character] = await database
    .select({ id: schema.characters.id })
    .from(schema.characters)
    .where(and(eq(schema.characters.stableKey, "lucia"), eq(schema.characters.characterVersion, 1)))
    .limit(1);
  if (!character) throw new Error("CHARACTER_UNAVAILABLE");
  return character;
}

export function createDrizzleLuciaContactRepository<TResult extends PgQueryResultHKT>(
  database: NetworkDatabase<TResult>,
): LuciaContactRepository {
  const repository: LuciaContactRepository = {
    async transaction(work) {
      return database.transaction((transaction) => work(createDrizzleLuciaContactRepository(transaction)));
    },

    async get(userId) {
      const character = await findLucia(database);
      const [relationship] = await database
        .select({ id: schema.characterRelationships.id, status: schema.characterRelationships.status, relationshipStage: schema.characterRelationships.relationshipStage })
        .from(schema.characterRelationships)
        .where(and(eq(schema.characterRelationships.userId, userId), eq(schema.characterRelationships.characterId, character.id)))
        .limit(1);
      const [conversation] = await database
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(and(eq(schema.conversations.userId, userId), eq(schema.conversations.characterId, character.id)))
        .limit(1);
      // Preserve conversations created before the friend-request gate existed.
      // They are already an established contact and must not be hidden.
      if (!relationship) {
        return {
          characterKey: "lucia",
          status: conversation ? "active" : "pending",
          relationshipStage: "new_contact",
          conversationId: conversation?.id ?? null,
          source,
        };
      }
      return {
        characterKey: "lucia",
        status: relationship.status as LuciaContactStatus,
        relationshipStage: relationship.relationshipStage as LuciaContactRecord["relationshipStage"],
        conversationId: conversation?.id ?? null,
        source,
      };
    },

    async respond(userId, decision) {
      const character = await findLucia(database);
      const current = await this.get(userId);
      if (current.status === "active") {
        if (decision === "accept" && !current.conversationId) {
          await database.insert(schema.conversations)
            .values({ userId, characterId: character.id })
            .onConflictDoNothing({ target: [schema.conversations.userId, schema.conversations.characterId] });
          return this.get(userId);
        }
        return current;
      }
      if (current.status === "declined" && decision === "decline") return current;

      if (current.status === "declined" && decision === "accept") {
        await database.update(schema.characterRelationships)
          .set({ status: "active", updatedAt: new Date() })
          .where(and(eq(schema.characterRelationships.userId, userId), eq(schema.characterRelationships.characterId, character.id)));
      } else if (current.status === "pending") {
        await database.insert(schema.characterRelationships)
          .values({ userId, characterId: character.id, status: decision === "accept" ? "active" : "declined", relationshipStage: "new_contact" })
          .onConflictDoUpdate({
            target: [schema.characterRelationships.userId, schema.characterRelationships.characterId],
            set: { status: decision === "accept" ? "active" : "declined", updatedAt: new Date() },
          });
      }

      if (decision === "accept") {
        await database.insert(schema.conversations)
          .values({ userId, characterId: character.id })
          .onConflictDoNothing({ target: [schema.conversations.userId, schema.conversations.characterId] });
      }
      return this.get(userId);
    },
  };
  return repository;
}
