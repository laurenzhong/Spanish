import { and, asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/src/shared/db/schema";
import type { RelationshipCompletionCandidate } from "../domain/relationship-candidate-extraction";
import { readRelationshipConversationContext } from "./relationship-context";

type Database<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;
const validKinds = new Set<RelationshipCompletionCandidate["kind"]>(["explicit_friend_boundary", "contact_stop", "voluntary_personal_anchor", "mutual_conversation_welcome", "user_continuity_return", "user_trust_or_value", "shared_positive_exchange", "explicit_romantic_openness", "explicit_romantic_confirmation", "user_romantic_declaration", "character_interest_signal", "character_relationship_proposal", "character_romantic_acceptance"]);
export async function recordRelationshipPendingReceipt<TResult extends PgQueryResultHKT>(database: Database<TResult>, input: Readonly<{ userId: string; conversationId: string; generationId: string; assistantMessageId: string; relationshipCandidates?: readonly RelationshipCompletionCandidate[] }>): Promise<boolean> {
  try {
    // Probe the catalog before touching the optional relationship tables. A
    // missing-table error aborts PostgreSQL's surrounding transaction, so
    // catching that error after the fact would also roll back the assistant
    // completion on older databases that predate migration 0056.
    const probe = await database.execute<{ exists: boolean }>(sql`select to_regclass('public.relationship_heads') is not null as exists`);
    const probeRows = Array.isArray(probe) ? probe : ((probe as unknown as { rows?: readonly { exists: boolean }[] }).rows ?? []);
    if (!probeRows[0]?.exists) return false;
    const [conversation] = await database.select({ identityId: schema.conversations.identityId, userId: schema.conversations.userId }).from(schema.conversations).where(and(eq(schema.conversations.id, input.conversationId), eq(schema.conversations.userId, input.userId))).for("update");
    if (!conversation?.identityId || conversation.userId !== input.userId) return false;
    let [head] = await database.select().from(schema.relationshipHeads).where(and(eq(schema.relationshipHeads.userId, input.userId), eq(schema.relationshipHeads.identityId, conversation.identityId))).for("update");
    if (!head) [head] = await database.insert(schema.relationshipHeads).values({ userId: input.userId, identityId: conversation.identityId }).returning();
    if (!head) return false;
    await database.insert(schema.relationshipPendingSources).values({ headId: head.id, userId: input.userId, identityId: conversation.identityId, receiptKey: `generation:${input.generationId}`, generationId: input.generationId, turnId: input.assistantMessageId }).onConflictDoNothing();
    const candidates = input.relationshipCandidates ?? [];
    if (candidates.length) {
      const relationshipContext = await readRelationshipConversationContext(database, { userId: input.userId, identityId: conversation.identityId }).catch(() => null);
      const links = await database.select({ userMessageId: schema.conversationReplySources.userMessageId }).from(schema.conversationReplySources).where(and(
        eq(schema.conversationReplySources.assistantMessageId, input.assistantMessageId), eq(schema.conversationReplySources.userId, input.userId), eq(schema.conversationReplySources.conversationId, input.conversationId),
      )).orderBy(asc(schema.conversationReplySources.position));
      const linkedIds = new Set(links.map((link) => link.userMessageId));
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]!;
        if (!validKinds.has(candidate.kind) || !["explicit", "supported"].includes(candidate.certainty) || !candidate.sourceMessageIds.length) continue;
        const assistantCandidate = ["character_interest_signal", "character_relationship_proposal", "character_romantic_acceptance"].includes(candidate.kind);
        if (assistantCandidate) {
          if (candidate.sourceRole !== "assistant" || candidate.sourceMessageIds.length !== 1 || candidate.sourceMessageIds[0] !== input.assistantMessageId) continue;
          if (!relationshipContext || relationshipContext.reconfirmationRequired) continue;
          if (candidate.kind === "character_interest_signal" && !["familiar", "close_friend"].includes(relationshipContext.relationshipStage)) continue;
          if (candidate.kind === "character_relationship_proposal" && (relationshipContext.userRomanticIntent !== "open" || relationshipContext.characterProposal !== "interest_expressed")) continue;
          if (candidate.kind === "character_romantic_acceptance" && relationshipContext.characterProposal !== "confirmation_pending") continue;
        } else if (candidate.sourceRole !== "user" || candidate.sourceMessageIds.some((id) => !linkedIds.has(id))) continue;
        if (candidate.kind === "explicit_romantic_confirmation" && (!relationshipContext || relationshipContext.characterProposal !== "confirmation_pending")) continue;
        if ((candidate.kind === "explicit_friend_boundary" || candidate.kind === "contact_stop") && (!candidate.boundary || candidate.boundary.target !== "all")) continue;
        const idempotencyKey = `generation:${input.generationId}:boundary:${candidate.kind}:${index}`;
        const [existing] = await database.select({ id: schema.relationshipEvents.id }).from(schema.relationshipEvents).where(and(eq(schema.relationshipEvents.headId, head.id), eq(schema.relationshipEvents.idempotencyKey, idempotencyKey)));
        if (existing) continue;
        const sequence = head.controlRevision + 1;
        let relatedSourceMessageIds = candidate.kind === "explicit_romantic_confirmation" ? [] : [...(candidate.relatedSourceMessageIds ?? [])];
        if (candidate.kind === "explicit_romantic_confirmation") {
          const [proposal] = await database.select({ id: schema.relationshipEvents.id }).from(schema.relationshipEvents).where(and(eq(schema.relationshipEvents.headId, head.id), eq(schema.relationshipEvents.eventKind, "character_relationship_proposal"))).orderBy(sql`${schema.relationshipEvents.sequence} desc`).limit(1);
          if (proposal) {
            relatedSourceMessageIds = (await database.select({ messageId: schema.relationshipEventSources.messageId }).from(schema.relationshipEventSources).where(eq(schema.relationshipEventSources.eventId, proposal.id)).orderBy(asc(schema.relationshipEventSources.position))).map((source) => source.messageId).filter((id): id is string => !!id);
          }
        }
        const [event] = await database.insert(schema.relationshipEvents).values({
          id: randomUUID(), headId: head.id, userId: input.userId, identityId: conversation.identityId, sequence,
          idempotencyKey, eventKind: candidate.kind, certainty: candidate.certainty, ruleVersion: "relationship-v1",
          generationId: input.generationId, turnId: input.assistantMessageId, episodeKey: `conversation:${input.conversationId}:turn:${input.assistantMessageId}`, payload: relatedSourceMessageIds.length ? { relatedSourceMessageIds } : {},
        }).returning({ id: schema.relationshipEvents.id });
        if (!event) continue;
        await database.insert(schema.relationshipEventSources).values(candidate.sourceMessageIds.map((messageId, position) => ({ eventId: event.id, messageId, sourceRole: candidate.sourceRole === "assistant" ? "character" : "user", position })));
        if (candidate.boundary) await database.insert(schema.relationshipBoundaries).values({
          headId: head.id, userId: input.userId, identityId: conversation.identityId, scope: candidate.boundary.scope,
          target: candidate.boundary.target, status: "active", sourceEventId: event.id,
          revision: sequence, idempotencyKey: `${idempotencyKey}:boundary`,
        });
        head = { ...head, controlRevision: sequence };
        await database.update(schema.relationshipHeads).set({ controlRevision: sequence, updatedAt: new Date() }).where(eq(schema.relationshipHeads.id, head.id));
      }
    }
    return true;
  } catch (error) {
    // The relationship migration is deliberately deployable after the chat code;
    // an old database skips only when PostgreSQL reports a missing relation.
    // Constraint, ownership, or transaction errors must propagate and roll back
    // the completed assistant message with the surrounding UoW.
    const candidate = error as { code?: string; cause?: { code?: string; message?: string } };
    const code = candidate.code ?? candidate.cause?.code;
    const message = `${String(error)} ${candidate.cause?.message ?? ""}`;
    if (code === "42P01" || /relation "(?:relationship_heads|relationship_pending_sources)" does not exist/u.test(message)) return false;
    throw error;
  }
}
