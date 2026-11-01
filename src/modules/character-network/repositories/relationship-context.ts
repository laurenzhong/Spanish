import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/src/shared/db/schema";
import { replayAcceptedRelationship, type AcceptedRelationshipReceipt, type RelationshipCandidate, type RelationshipLedger, type RelationshipSource, type RelationshipTurn } from "../domain/relationship-state";

type Database<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;
export type RelationshipConversationContext = Readonly<{
  relationshipStage: "new_contact" | "getting_to_know_you" | "familiar" | "close_friend";
  relationshipSignalsSummary: string | null;
  proactiveAllowed: boolean;
  reconfirmationRequired: boolean;
  userRomanticIntent: "unspecified" | "open" | "confirmed" | "friends_only" | "paused";
  characterProposal: "none" | "interest_expressed" | "confirmation_pending" | "confirmed";
}>;

export type PersistedEventProjection = Readonly<{ kind: string; episodeKey: string | null }>;

type PersistedReplay = Readonly<{
  relationshipStage: RelationshipConversationContext["relationshipStage"];
  proactiveAllowed: boolean;
  reconfirmationRequired: boolean;
  userRomanticIntent: RelationshipConversationContext["userRomanticIntent"];
  characterProposal: RelationshipConversationContext["characterProposal"];
}>;

async function replayPersistedEvents<TResult extends PgQueryResultHKT>(database: Database<TResult>, input: Readonly<{ userId: string; identityId: string; epoch: string; events: readonly typeof schema.relationshipEvents.$inferSelect[] }>): Promise<PersistedReplay | null> {
  if (!input.events.length) return null;
  const eventIds = input.events.map((event) => event.id);
  const sourceRows = await database.select({ eventId: schema.relationshipEventSources.eventId, messageId: schema.relationshipEventSources.messageId, sourceRole: schema.relationshipEventSources.sourceRole, tombstoned: schema.relationshipEventSources.tombstoned })
    .from(schema.relationshipEventSources).where(inArray(schema.relationshipEventSources.eventId, eventIds));
  const turnIds = [...new Set(input.events.map((event) => event.turnId).filter((id): id is string => !!id))];
  const turnLinks = turnIds.length
    ? await database.select({ assistantMessageId: schema.conversationReplySources.assistantMessageId, userMessageId: schema.conversationReplySources.userMessageId }).from(schema.conversationReplySources).where(inArray(schema.conversationReplySources.assistantMessageId, turnIds))
    : [];
  const messageIds = [...new Set([...sourceRows.map((row) => row.messageId), ...turnLinks.map((row) => row.userMessageId), ...turnLinks.map((row) => row.assistantMessageId)].filter((id): id is string => !!id))];
  if (!messageIds.length) return null;
  const messages = await database.select({ id: schema.messages.id, role: schema.messages.role, status: schema.messages.status, generationId: schema.messages.generationId, characterId: schema.messages.characterId }).from(schema.messages).where(inArray(schema.messages.id, messageIds));
  const eventForSource = new Map<string, typeof input.events[number]>();
  for (const row of sourceRows) {
    if (row.messageId && !eventForSource.has(row.messageId)) {
      const event = input.events.find((candidate) => candidate.id === row.eventId);
      if (event) eventForSource.set(row.messageId, event);
    }
  }
  const sourceFor = (message: typeof messages[number]): RelationshipSource => {
    const event = eventForSource.get(message.id);
    const sourceRow = sourceRows.find((row) => row.messageId === message.id);
    const role = message.role === "character" ? "assistant" : "user";
    return {
      ownerId: input.userId, identityId: input.identityId, epoch: input.epoch, id: message.id, role,
      status: sourceRow?.tombstoned ? "deleted" : message.status === "completed" ? "completed" : message.status === "withdrawn" ? "withdrawn" : "failed",
      generationId: message.generationId ?? undefined, turnId: event?.turnId ?? undefined,
      sessionId: event?.episodeKey ?? `event:${event?.id ?? message.id}`, episodeId: event?.episodeKey ?? `event:${event?.id ?? message.id}`,
      characterVersion: undefined,
    };
  };
  const ledgerMessages = messages.map(sourceFor);
  const turns: RelationshipTurn[] = [];
  for (const event of input.events) {
    if (!event.turnId || turns.some((turn) => turn.id === event.turnId)) continue;
    const assistant = messages.find((message) => message.id === event.turnId);
    const links = turnLinks.filter((link) => link.assistantMessageId === event.turnId);
    if (!assistant || assistant.role !== "character" || !assistant.generationId || !links.length) continue;
    turns.push({ ownerId: input.userId, identityId: input.identityId, epoch: input.epoch, id: event.turnId, generationId: assistant.generationId,
      userMessageIds: links.map((link) => link.userMessageId), assistantMessageId: event.turnId,
      status: assistant.status === "completed" ? "completed" : "failed", characterVersion: event.characterVersion ?? 1 });
  }
  if (!turns.length) return null;
  const ledger: RelationshipLedger = { messages: ledgerMessages, turns };
  const receipts: AcceptedRelationshipReceipt[] = [];
  for (const event of input.events) {
    const turn = turns.find((candidate) => candidate.id === event.turnId);
    if (!turn) continue;
    const sources = sourceRows.filter((row) => row.eventId === event.id && !!row.messageId);
    if (!sources.length) continue;
    const candidateBase: RelationshipCandidate = {
      kind: event.eventKind as RelationshipCandidate["kind"],
      certainty: event.certainty as RelationshipCandidate["certainty"],
      semanticVerified: true,
      sourceMessageIds: sources.map((source) => source.messageId!).filter(Boolean),
      ...(event.eventKind === "user_continuity_return"
        ? { relatedSourceMessageIds: sourceRows.filter((source) => input.events.some((prior) => prior.id === source.eventId && prior.eventKind === "voluntary_personal_anchor" && prior.sequence < event.sequence) && !!source.messageId).map((source) => source.messageId!).filter(Boolean) }
        : {}),
      ...((event.payload && typeof event.payload === "object" && Array.isArray((event.payload as Record<string, unknown>).relatedSourceMessageIds))
        ? { relatedSourceMessageIds: ((event.payload as Record<string, unknown>).relatedSourceMessageIds as unknown[]).filter((id): id is string => typeof id === "string") }
        : {}),
    };
    const boundary = await database.select({ scope: schema.relationshipBoundaries.scope, target: schema.relationshipBoundaries.target }).from(schema.relationshipBoundaries).where(eq(schema.relationshipBoundaries.sourceEventId, event.id)).limit(1);
    const candidate: RelationshipCandidate = boundary[0]
      ? { ...candidateBase, boundary: { scope: boundary[0].scope as "romance" | "nickname" | "topic" | "proactive" | "contact", target: boundary[0].target } }
      : candidateBase;
    const generationId = event.generationId ?? turn.generationId;
    const assistantKind = ["character_interest_signal", "character_relationship_proposal", "character_romantic_acceptance"].includes(candidate.kind);
    receipts.push({ commit: { ownerId: input.userId, identityId: input.identityId, epoch: input.epoch, sequence: event.sequence, mode: "completed", turnId: turn.id, generationId, expectedBoundaryRevision: Math.max(0, event.sequence - 1), candidates: [candidate], ...(assistantKind ? { permit: { ownerId: input.userId, identityId: input.identityId, epoch: input.epoch, boundaryRevision: Math.max(0, event.sequence - 1), userMessageId: turn.userMessageIds.at(-1)!, generationId, turnId: turn.id, allowInterest: candidate.kind === "character_interest_signal", allowProposal: candidate.kind === "character_relationship_proposal", allowAcceptance: candidate.kind === "character_romantic_acceptance" } } : {}) }, turn, boundaryRevisionAfter: event.sequence });
  }
  if (!receipts.length) return null;
  const state = replayAcceptedRelationship({ scope: { ownerId: input.userId, identityId: input.identityId, epoch: input.epoch }, ledger, acceptedReceipts: receipts, capabilities: { romance: true }, boundaryRevision: Math.max(...input.events.map((event) => event.sequence)) });
  return { relationshipStage: state.familiarity, proactiveAllowed: state.proactiveAllowed, reconfirmationRequired: state.interactionSafety === "reconfirmation_required", userRomanticIntent: state.userRomanticIntent, characterProposal: state.characterProposal };
}

export function projectRelationshipStage(events: readonly PersistedEventProjection[]): RelationshipConversationContext["relationshipStage"] {
  const anchor = events.find((event) => event.kind === "voluntary_personal_anchor" && event.episodeKey);
  const welcome = events.find((event) => event.kind === "mutual_conversation_welcome" && event.episodeKey && event.episodeKey !== anchor?.episodeKey);
  const returned = events.find((event) => event.kind === "user_continuity_return" && event.episodeKey && ![anchor?.episodeKey, welcome?.episodeKey].includes(event.episodeKey));
  const trust = events.find((event) => event.kind === "user_trust_or_value" && event.episodeKey && ![anchor?.episodeKey, welcome?.episodeKey, returned?.episodeKey].includes(event.episodeKey));
  const positive = events.find((event) => ["shared_positive_exchange", "boundary_respected_and_return"].includes(event.kind) && event.episodeKey && ![anchor?.episodeKey, welcome?.episodeKey, returned?.episodeKey, trust?.episodeKey].includes(event.episodeKey));
  if (anchor && welcome && returned && trust && positive) return "close_friend";
  if (anchor && welcome && returned) return "familiar";
  if (anchor && (welcome || returned)) return "getting_to_know_you";
  return "new_contact";
}

/** Reads only server-persisted relationship controls for ordinary and proactive callers. */
export async function readRelationshipConversationContext<TResult extends PgQueryResultHKT>(database: Database<TResult>, input: Readonly<{ userId: string; identityId: string }>): Promise<RelationshipConversationContext | null> {
  const probe = await database.execute<{ exists: boolean }>(sql`select to_regclass('public.relationship_heads') is not null as exists`);
  const rows = Array.isArray(probe) ? probe : ((probe as unknown as { rows?: readonly { exists: boolean }[] }).rows ?? []);
  if (!rows[0]?.exists) return null;
  const [head] = await database.select({ id: schema.relationshipHeads.id, epoch: schema.relationshipHeads.epoch }).from(schema.relationshipHeads).where(and(eq(schema.relationshipHeads.userId, input.userId), eq(schema.relationshipHeads.identityId, input.identityId))).limit(1);
  if (!head) return null;
  const events = await database.select().from(schema.relationshipEvents).where(eq(schema.relationshipEvents.headId, head.id)).orderBy(asc(schema.relationshipEvents.sequence));
  const liveSources = events.length === 0
    ? []
    : await database.select({ eventId: schema.relationshipEventSources.eventId })
      .from(schema.relationshipEventSources)
      .where(and(eq(schema.relationshipEventSources.tombstoned, false), sql`${schema.relationshipEventSources.eventId} in (${sql.join(events.map((event) => sql`${event.id}`), sql`, `)})`));
  const liveEventIds = new Set(liveSources.map((source) => source.eventId));
  const boundaries = await database.select({ scope: schema.relationshipBoundaries.scope, target: schema.relationshipBoundaries.target, status: schema.relationshipBoundaries.status }).from(schema.relationshipBoundaries).where(and(eq(schema.relationshipBoundaries.headId, head.id), eq(schema.relationshipBoundaries.status, "active"))).orderBy(desc(schema.relationshipBoundaries.revision));
  const romanceOnly = boundaries.some((boundary) => boundary.scope === "romance" && boundary.target === "all");
  const contactStopped = boundaries.some((boundary) => boundary.scope === "contact" && boundary.target === "all");
  const proactiveStopped = boundaries.some((boundary) => boundary.scope === "proactive" && boundary.target === "all");
  const liveEvents = events.filter((event) => liveEventIds.has(event.id));
  const replayed = liveEvents.length
    ? await replayPersistedEvents(database, { userId: input.userId, identityId: input.identityId, epoch: head.epoch, events }).catch(() => ({ relationshipStage: "new_contact" as const, proactiveAllowed: false, reconfirmationRequired: true, userRomanticIntent: "unspecified" as const, characterProposal: "none" as const }))
    : null;
  const signals = [
    romanceOnly ? "La persona ha pedido mantener la relación en amistad; no coquetees ni sugieras romance." : null,
    contactStopped || proactiveStopped ? "La persona ha pedido no recibir mensajes proactivos; responde solo cuando ella escriba." : null,
    (replayed?.reconfirmationRequired || (liveEvents.some((event) => event.eventKind === "conflict_reported") && !liveEvents.some((event) => event.eventKind === "repair_acknowledged"))) ? "Hay un conflicto no resuelto; no aumentes la intimidad." : null,
  ].filter((value): value is string => value !== null);
  return { relationshipStage: replayed?.relationshipStage ?? projectRelationshipStage(liveEvents.map((event) => ({ kind: event.eventKind, episodeKey: event.episodeKey }))), relationshipSignalsSummary: signals.length ? signals.join(" ") : null, proactiveAllowed: (replayed?.proactiveAllowed ?? true) && !contactStopped && !proactiveStopped, reconfirmationRequired: replayed?.reconfirmationRequired ?? false, userRomanticIntent: replayed?.userRomanticIntent ?? "unspecified", characterProposal: replayed?.characterProposal ?? "none" };
}
