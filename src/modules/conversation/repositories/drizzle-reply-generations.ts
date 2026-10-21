import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/src/shared/db/schema";
import type { ConversationMessageRecord, ConversationRepository, ReplyGenerationScope } from "./conversation-repository";

type Database<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;
function message(row: typeof schema.messages.$inferSelect): ConversationMessageRecord {
  return { ...row, role: row.role === "character" ? "character" : "user" };
}

/** Every generation mutation takes the same short conversation lock. No provider work runs in this transaction. */
async function lockConversation<TResult extends PgQueryResultHKT>(database: Database<TResult>, input: ReplyGenerationScope) {
  const [conversation] = await database.select().from(schema.conversations)
    .where(and(eq(schema.conversations.id, input.conversationId), eq(schema.conversations.userId, input.userId))).for("update");
  return conversation;
}
function generationWhere(input: ReplyGenerationScope) {
  return and(eq(schema.messages.userId, input.userId), eq(schema.messages.conversationId, input.conversationId),
    eq(schema.messages.clientMessageId, `assistant-${input.generationId}`), eq(schema.messages.generationId, input.generationId), eq(schema.messages.role, "character"));
}
async function liveParent<TResult extends PgQueryResultHKT>(database: Database<TResult>, input: ReplyGenerationScope, parentId: string | null) {
  if (!parentId) return false;
  const [parent] = await database.select({ id: schema.messages.id }).from(schema.messages)
    .where(and(eq(schema.messages.id, parentId), eq(schema.messages.userId, input.userId), eq(schema.messages.conversationId, input.conversationId), eq(schema.messages.role, "user"), eq(schema.messages.status, "completed"))).for("update");
  return Boolean(parent);
}
async function sourcesFor<TResult extends PgQueryResultHKT>(database: Database<TResult>, input: ReplyGenerationScope, assistantMessageId: string) {
  return database.select({ userMessageId: schema.conversationReplySources.userMessageId }).from(schema.conversationReplySources).where(and(
    eq(schema.conversationReplySources.userId, input.userId), eq(schema.conversationReplySources.conversationId, input.conversationId),
    eq(schema.conversationReplySources.assistantMessageId, assistantMessageId),
  )).orderBy(asc(schema.conversationReplySources.position));
}
async function liveBatch<TResult extends PgQueryResultHKT>(database: Database<TResult>, input: ReplyGenerationScope, assistantMessageId: string, userMessageIds?: readonly string[]) {
  const sources = await sourcesFor(database, input, assistantMessageId);
  const ids = sources.map((row) => row.userMessageId);
  if (!ids.length || (userMessageIds && (userMessageIds.length !== ids.length || userMessageIds.some((id, index) => id !== ids[index])))) return false;
  const rows = await database.select({ id: schema.messages.id }).from(schema.messages).where(and(
    eq(schema.messages.userId, input.userId), eq(schema.messages.conversationId, input.conversationId),
    eq(schema.messages.role, "user"), eq(schema.messages.status, "completed"), inArray(schema.messages.id, ids),
  )).for("update");
  return rows.length === ids.length;
}

/** Called under the same owned conversation lock as generation writes. Source deletion never removes unrelated replies. */
export async function invalidateConversationReplies<TResult extends PgQueryResultHKT>(database: Database<TResult>, input: Readonly<{ userId: string; conversationId: string; userMessageId: string }>) {
  const linkedIds = database.select({ id: schema.conversationReplySources.assistantMessageId }).from(schema.conversationReplySources).where(and(
    eq(schema.conversationReplySources.userId, input.userId), eq(schema.conversationReplySources.conversationId, input.conversationId), eq(schema.conversationReplySources.userMessageId, input.userMessageId),
  ));
  const removed = await database.delete(schema.messages).where(and(
    eq(schema.messages.userId, input.userId), eq(schema.messages.conversationId, input.conversationId), eq(schema.messages.role, "character"),
    or(eq(schema.messages.replyToMessageId, input.userMessageId), inArray(schema.messages.id, linkedIds)),
  )).returning();
  // A content-free cancellation marker keeps a delayed/reduced retry from reclaiming a privacy-deleted generation.
  const tombstones = removed.filter((row) => row.generationId && row.clientMessageId === `assistant-${row.generationId}`).map((row) => ({
    id: randomUUID(), userId: input.userId, conversationId: input.conversationId, characterId: row.characterId, identityId: row.identityId,
    clientMessageId: row.clientMessageId, generationId: row.generationId, role: "character" as const, status: "cancelled" as const, content: "", sourceType: "generation_tombstone",
  }));
  if (tombstones.length) await database.insert(schema.messages).values(tombstones);
}

export function createDrizzleReplyGenerationRepository<TResult extends PgQueryResultHKT>(database: Database<TResult>): Pick<ConversationRepository, "claimReplyGeneration" | "saveReplyPrefix" | "finishReplyGeneration" | "cancelReplyGeneration"> {
  return {
    async claimReplyGeneration(input) {
      return database.transaction(async (transaction) => {
        const conversation = await lockConversation(transaction, input);
        if (!conversation) throw new Error("CONVERSATION_UNAVAILABLE");
        const [identity] = await transaction.select({ id: schema.characterIdentities.id, revisionId: schema.characters.id }).from(schema.characterIdentities)
          .innerJoin(schema.characters, eq(schema.characters.id, schema.characterIdentities.currentCharacterId))
          .where(and(eq(schema.characterIdentities.id, conversation.identityId!), eq(schema.characterIdentities.stableKey, input.characterKey), eq(schema.characters.status, "published")));
        if (!identity) throw new Error("CHARACTER_UNAVAILABLE");
        if (!input.messages.length || input.messages.length > 20 || new Set(input.messages.map((row) => row.clientMessageId)).size !== input.messages.length) throw new Error("MESSAGE_CONFLICT");
        const [existing] = await transaction.select().from(schema.messages).where(generationWhere(input));
        if (existing?.sourceType === "generation_tombstone") return { status: "cancelled" as const, assistant: message(existing), userMessages: [] };

        const userMessages: ConversationMessageRecord[] = [];
        // Full-batch validation occurs before insertion; any conflict rolls back the whole claim.
        const existingUsers = await transaction.select().from(schema.messages).where(and(
          eq(schema.messages.userId, input.userId), eq(schema.messages.conversationId, input.conversationId), inArray(schema.messages.clientMessageId, input.messages.map((row) => row.clientMessageId)),
        ));
        for (const pending of input.messages) {
          const stored = existingUsers.find((row) => row.clientMessageId === pending.clientMessageId);
          if (stored && (stored.role !== "user" || stored.status !== "completed" || stored.content !== pending.text || stored.sourceType !== (pending.assistance === "translation" ? "translation_assisted" : "conversation"))) throw new Error("MESSAGE_CONFLICT");
          if (existing && !stored) throw new Error("MESSAGE_CONFLICT");
        }
        if (existing) {
          const sources = await sourcesFor(transaction, input, existing.id);
          const requestedIds = input.messages.map((pending) => existingUsers.find((stored) => stored.clientMessageId === pending.clientMessageId)?.id);
          if (sources.length !== requestedIds.length || sources.some((source, index) => source.userMessageId !== requestedIds[index])) throw new Error("MESSAGE_CONFLICT");
        }
        const latestInput = existingUsers.find((row) => row.clientMessageId === input.messages.at(-1)!.clientMessageId);
        if (!existing && latestInput) {
          const [latestStored] = await transaction.select({ id: schema.messages.id }).from(schema.messages).where(and(
            eq(schema.messages.userId, input.userId), eq(schema.messages.conversationId, input.conversationId), eq(schema.messages.role, "user"), eq(schema.messages.status, "completed"),
          )).orderBy(desc(schema.messages.createdAt)).limit(1);
          if (latestStored && latestStored.id !== latestInput.id) {
            // An entire newer batch may arrive before every older request. The
            // newer batch already saved their user IDs, so server order catches
            // ancestors not named by its immediate supersedes tombstone.
            const [tombstone] = await transaction.insert(schema.messages).values({
              id: input.messageId, userId: input.userId, conversationId: input.conversationId, characterId: identity.revisionId, identityId: identity.id,
              clientMessageId: `assistant-${input.generationId}`, generationId: input.generationId, role: "character", status: "cancelled", content: "", sourceType: "generation_tombstone",
            }).returning();
            return { status: "cancelled" as const, assistant: message(tombstone), userMessages: input.messages.flatMap((pending) => {
              const row = existingUsers.find((stored) => stored.clientMessageId === pending.clientMessageId);
              return row ? [message(row)] : [];
            }) };
          }
        }
        if (existing && existing.replyToMessageId !== existingUsers.find((row) => row.clientMessageId === input.messages.at(-1)!.clientMessageId)?.id) throw new Error("MESSAGE_CONFLICT");
        for (const pending of input.messages) {
          const stored = existingUsers.find((row) => row.clientMessageId === pending.clientMessageId);
          if (stored) { userMessages.push(message(stored)); continue; }
          const [inserted] = await transaction.insert(schema.messages).values({
            userId: input.userId, conversationId: input.conversationId, characterId: identity.revisionId, identityId: identity.id,
            clientMessageId: pending.clientMessageId, generationId: input.generationId, role: "user", status: "completed", content: pending.text,
            sourceType: pending.assistance === "translation" ? "translation_assisted" : "conversation", completedAt: new Date(), createdAt: sql`clock_timestamp()`,
          }).returning();
          userMessages.push(message(inserted));
        }
        if (existing) return { status: existing.status === "completed" ? "completed" as const : existing.status === "streaming" ? "in-progress" as const : "cancelled" as const, assistant: message(existing), userMessages };

        if (input.supersedes) {
          if (input.supersedes.generationId === input.generationId) throw new Error("MESSAGE_CONFLICT");
          const superseded = { ...input, generationId: input.supersedes.generationId };
          const [old] = await transaction.select().from(schema.messages).where(generationWhere(superseded));
          if (old && (old.status === "streaming" || old.status === "cancelled")) {
            const bubbles = old.content.trim() ? old.content.split(/\n\s*\n/u) : [];
            const content = bubbles.slice(0, input.supersedes.visibleBubbleCount).join("\n\n");
            await transaction.update(schema.messages).set({ status: "cancelled", content, updatedAt: new Date() }).where(eq(schema.messages.id, old.id));
          } else if (!old) {
            // Cancelling an unclaimed request must survive that request arriving late.
            await transaction.insert(schema.messages).values({
              id: randomUUID(), userId: input.userId, conversationId: input.conversationId, characterId: identity.revisionId, identityId: identity.id,
              clientMessageId: `assistant-${superseded.generationId}`, generationId: superseded.generationId, role: "character", status: "cancelled", content: "", sourceType: "generation_tombstone",
            });
          }
        }
        await transaction.update(schema.messages).set({ status: "cancelled", updatedAt: new Date() }).where(and(
          eq(schema.messages.userId, input.userId), eq(schema.messages.conversationId, input.conversationId), eq(schema.messages.role, "character"), eq(schema.messages.status, "streaming"),
        ));
        const [assistant] = await transaction.insert(schema.messages).values({
          id: input.messageId, userId: input.userId, conversationId: input.conversationId, characterId: identity.revisionId, identityId: identity.id,
          clientMessageId: `assistant-${input.generationId}`, generationId: input.generationId, role: "character", status: "streaming", content: "", replyToMessageId: userMessages.at(-1)!.id, createdAt: sql`clock_timestamp()`,
        }).returning();
        await transaction.insert(schema.conversationReplySources).values(userMessages.map((source, position) => ({
          assistantMessageId: assistant.id, userMessageId: source.id, userId: input.userId, conversationId: input.conversationId, position,
        })));
        await transaction.update(schema.conversations).set({ lastMessageAt: userMessages.at(-1)!.createdAt, updatedAt: new Date() }).where(eq(schema.conversations.id, input.conversationId));
        return { status: "claimed" as const, assistant: message(assistant), userMessages };
      });
    },
    async saveReplyPrefix(input) {
      return database.transaction(async (transaction) => {
        if (!await lockConversation(transaction, input)) return false;
        const [row] = await transaction.select().from(schema.messages).where(generationWhere(input)).for("update");
        if (!row || row.status !== "streaming" || !await liveParent(transaction, input, row.replyToMessageId) || !await liveBatch(transaction, input, row.id, input.userMessageIds)) return false;
        if (!input.prefix.trim() || (row.content && input.prefix !== row.content && !input.prefix.startsWith(`${row.content}\n\n`))) return false;
        await transaction.update(schema.messages).set({ content: input.prefix, updatedAt: new Date() }).where(eq(schema.messages.id, row.id));
        await transaction.update(schema.conversations).set({ lastMessageAt: row.createdAt, updatedAt: new Date() }).where(eq(schema.conversations.id, input.conversationId));
        return true;
      });
    },
    async finishReplyGeneration(input) {
      return database.transaction(async (transaction) => {
        if (!await lockConversation(transaction, input)) return null;
        const [row] = await transaction.select().from(schema.messages).where(generationWhere(input)).for("update");
        if (!row || row.status !== "streaming" || !input.content.trim() || row.content !== input.content || !await liveParent(transaction, input, row.replyToMessageId) || !await liveBatch(transaction, input, row.id, input.userMessageIds)) return null;
        const [completed] = await transaction.update(schema.messages).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(schema.messages.id, row.id)).returning();
        return message(completed);
      });
    },
    async cancelReplyGeneration(input) {
      return database.transaction(async (transaction) => {
        if (!await lockConversation(transaction, input)) return false;
        const cancelled = await transaction.update(schema.messages).set({ status: "cancelled", updatedAt: new Date() }).where(and(generationWhere(input), eq(schema.messages.status, "streaming"))).returning({ id: schema.messages.id });
        return cancelled.length > 0;
      });
    },
  };
}
