import { and, count, desc, eq, gte } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type { ProactiveEligibilityState, ProactiveMessageSource } from "../domain/proactive-message";
import type { ConversationMessageRecord } from "./conversation-repository";
import type { ProactiveMessageCandidateRecord, ProactiveMessageRepository, ProactiveCandidateStatus } from "./proactive-message-repository";

type ConversationDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

function toMessage(row: typeof schema.messages.$inferSelect): ConversationMessageRecord {
  return {
    id: row.id,
    clientMessageId: row.clientMessageId,
    generationId: row.generationId,
    role: row.role === "character" ? "character" : "user",
    status: row.status,
    content: row.content,
    replyToMessageId: row.replyToMessageId,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    sourceType: row.sourceType,
  };
}

function toCandidate(row: typeof schema.proactiveMessageCandidates.$inferSelect): ProactiveMessageCandidateRecord {
  return {
    id: row.id,
    userId: row.userId,
    characterKey: "lucia",
    conversationId: row.conversationId,
    sourceType: row.sourceType as ProactiveMessageSource,
    dedupeKey: row.dedupeKey,
    generationId: row.generationId,
    notBefore: row.notBefore,
    expiresAt: row.expiresAt,
    status: row.status as ProactiveCandidateStatus,
    messageId: row.messageId,
    notificationStatus: row.notificationStatus as ProactiveMessageCandidateRecord["notificationStatus"],
    lastErrorCode: row.lastErrorCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findLucia<TResult extends PgQueryResultHKT>(database: ConversationDatabase<TResult>) {
  const [character] = await database.select({ id: schema.characters.id })
    .from(schema.characters)
    .where(and(eq(schema.characters.stableKey, "lucia"), eq(schema.characters.characterVersion, 1)))
    .limit(1);
  if (!character) throw new Error("CHARACTER_UNAVAILABLE");
  return character;
}

export function createDrizzleProactiveMessageRepository<TResult extends PgQueryResultHKT>(
  database: ConversationDatabase<TResult>,
): ProactiveMessageRepository {
  return {
    async getConversationId(userId) {
      const character = await findLucia(database);
      const [conversation] = await database.select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(and(eq(schema.conversations.userId, userId), eq(schema.conversations.characterId, character.id)))
        .limit(1);
      if (!conversation) throw new Error("CONVERSATION_UNAVAILABLE");
      return conversation.id;
    },
    async getEligibilityState(userId, now): Promise<ProactiveEligibilityState> {
      const character = await findLucia(database);
      const [relationship] = await database.select({
        status: schema.characterRelationships.status,
        relationshipStage: schema.characterRelationships.relationshipStage,
        relationshipSummary: schema.characterRelationships.relationshipSummary,
      }).from(schema.characterRelationships)
        .where(and(eq(schema.characterRelationships.userId, userId), eq(schema.characterRelationships.characterId, character.id)))
        .limit(1);
      const [conversation] = await database.select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(and(eq(schema.conversations.userId, userId), eq(schema.conversations.characterId, character.id)))
        .limit(1);
      if (!conversation) {
        return {
          relationshipStatus: relationship?.status === "active" ? "active" : "inactive",
          relationshipStage: (relationship?.relationshipStage ?? "new_contact") as ProactiveEligibilityState["relationshipStage"],
          relationshipSummary: null,
          proactiveEnabled: true,
          lastInteractionAt: null,
          lastProactiveMessageAt: null,
          proactiveCount24h: 0,
          proactiveCount7d: 0,
          hasUnansweredProactive: false,
        };
      }
      const day = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
      const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);
      const [lastUser] = await database.select({ createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(and(eq(schema.messages.conversationId, conversation.id), eq(schema.messages.role, "user"), eq(schema.messages.status, "completed")))
        .orderBy(desc(schema.messages.createdAt)).limit(1);
      const [lastProactive] = await database.select({ createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(and(eq(schema.messages.conversationId, conversation.id), eq(schema.messages.sourceType, "proactive"), eq(schema.messages.status, "completed")))
        .orderBy(desc(schema.messages.createdAt)).limit(1);
      const [{ count: count24h }] = await database.select({ count: count() }).from(schema.messages)
        .where(and(eq(schema.messages.conversationId, conversation.id), eq(schema.messages.sourceType, "proactive"), eq(schema.messages.status, "completed"), gte(schema.messages.createdAt, day)));
      const [{ count: count7d }] = await database.select({ count: count() }).from(schema.messages)
        .where(and(eq(schema.messages.conversationId, conversation.id), eq(schema.messages.sourceType, "proactive"), eq(schema.messages.status, "completed"), gte(schema.messages.createdAt, week)));
      return {
        relationshipStatus: relationship?.status === "active" ? "active" : "inactive",
        relationshipStage: (relationship?.relationshipStage ?? "new_contact") as ProactiveEligibilityState["relationshipStage"],
        relationshipSummary: relationship?.relationshipSummary?.es ?? null,
        proactiveEnabled: true,
        lastInteractionAt: lastUser?.createdAt ?? null,
        lastProactiveMessageAt: lastProactive?.createdAt ?? null,
        proactiveCount24h: Number(count24h),
        proactiveCount7d: Number(count7d),
        hasUnansweredProactive: Boolean(lastProactive && (!lastUser || lastProactive.createdAt > lastUser.createdAt)),
      };
    },

    async createCandidate(input) {
      const character = await findLucia(database);
      const [existing] = await database.select().from(schema.proactiveMessageCandidates)
        .where(and(eq(schema.proactiveMessageCandidates.userId, input.userId), eq(schema.proactiveMessageCandidates.dedupeKey, input.dedupeKey))).limit(1);
      if (existing) return toCandidate(existing);
      const [candidate] = await database.insert(schema.proactiveMessageCandidates).values({
        userId: input.userId,
        characterId: character.id,
        conversationId: input.conversationId,
        sourceType: input.sourceType,
        dedupeKey: input.dedupeKey,
        generationId: input.generationId,
        notBefore: input.notBefore,
        expiresAt: input.expiresAt ?? null,
        status: "generating",
      }).onConflictDoNothing({ target: [schema.proactiveMessageCandidates.userId, schema.proactiveMessageCandidates.dedupeKey] }).returning();
      if (candidate) return toCandidate(candidate);
      const [raced] = await database.select().from(schema.proactiveMessageCandidates)
        .where(and(eq(schema.proactiveMessageCandidates.userId, input.userId), eq(schema.proactiveMessageCandidates.dedupeKey, input.dedupeKey))).limit(1);
      if (!raced) throw new Error("PROACTIVE_CANDIDATE_UNAVAILABLE");
      return toCandidate(raced);
    },

    async completeCandidate(input) {
      return database.transaction(async (transaction) => {
        const [candidate] = await transaction.select().from(schema.proactiveMessageCandidates)
          .where(and(eq(schema.proactiveMessageCandidates.id, input.candidateId), eq(schema.proactiveMessageCandidates.userId, input.userId))).limit(1);
        if (!candidate) throw new Error("PROACTIVE_CANDIDATE_UNAVAILABLE");
        if (candidate.status === "generated" && candidate.messageId) {
          const [message] = await transaction.select().from(schema.messages).where(eq(schema.messages.id, candidate.messageId)).limit(1);
          if (!message) throw new Error("PROACTIVE_MESSAGE_UNAVAILABLE");
          return { candidate: toCandidate(candidate), message: toMessage(message) };
        }
        const [message] = await transaction.insert(schema.messages).values({
          id: input.messageId,
          userId: input.userId,
          conversationId: candidate.conversationId,
          characterId: candidate.characterId,
          clientMessageId: `proactive-${candidate.id}`,
          generationId: input.generationId,
          role: "character",
          status: "completed",
          sourceType: "proactive",
          content: input.content,
          completedAt: new Date(),
        }).onConflictDoNothing({ target: [schema.messages.conversationId, schema.messages.clientMessageId] }).returning();
        if (!message) throw new Error("PROACTIVE_MESSAGE_UNAVAILABLE");
        await transaction.update(schema.proactiveMessageCandidates).set({ status: "generated", messageId: message.id, updatedAt: new Date() })
          .where(and(eq(schema.proactiveMessageCandidates.id, candidate.id), eq(schema.proactiveMessageCandidates.userId, input.userId)));
        await transaction.update(schema.conversations).set({ lastMessageAt: message.createdAt, updatedAt: new Date() }).where(eq(schema.conversations.id, candidate.conversationId));
        const [updated] = await transaction.select().from(schema.proactiveMessageCandidates).where(eq(schema.proactiveMessageCandidates.id, candidate.id)).limit(1);
        if (!updated) throw new Error("PROACTIVE_CANDIDATE_UNAVAILABLE");
        return { candidate: toCandidate(updated), message: toMessage(message) };
      });
    },

    async failCandidate(input) {
      await database.update(schema.proactiveMessageCandidates).set({ status: "failed", lastErrorCode: input.errorCode, updatedAt: new Date() })
        .where(and(eq(schema.proactiveMessageCandidates.id, input.candidateId), eq(schema.proactiveMessageCandidates.userId, input.userId)));
    },
  };
}
