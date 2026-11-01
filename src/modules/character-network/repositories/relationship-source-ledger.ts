import { asc, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/src/shared/db/schema";
import type { RelationshipScope } from "../domain/relationship-state";

type Database<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;
export type RelationshipSourceMetadata = RelationshipScope & Readonly<{
  messageId: string; sessionId: string; episodeId: string;
}>;
export type NormalizedRelationshipMessage = RelationshipScope & Readonly<{
  id: string; conversationId: string; role: "user" | "assistant";
  status: "completed" | "pending" | "failed" | "withdrawn";
  /** Audit value only. Membership and generation authority come from turns, not a user's nullable field. */
  generationId: string | null;
  characterVersion: number | null;
  createdAtMs: number; completedAtMs: number | null;
}>;
export type NormalizedRelationshipTurn = RelationshipScope & Readonly<{
  id: string; conversationId: string; assistantMessageId: string; generationId: string;
  userMessageIds: readonly string[]; characterVersion: number;
  status: "completed" | "pending" | "failed";
}>;
export type NormalizedRelationshipReceipts = Readonly<{
  scope: RelationshipScope;
  messages: readonly NormalizedRelationshipMessage[];
  turns: readonly NormalizedRelationshipTurn[];
  sourceMetadata: readonly RelationshipSourceMetadata[];
  missingRetainedUserMessageIds: readonly string[];
}>;

export class RelationshipSourceLedgerError extends Error {
  constructor(readonly code: "RELATIONSHIP_SOURCE_UNAVAILABLE" | "RELATIONSHIP_SOURCE_METADATA_INVALID" | "RELATIONSHIP_SOURCE_BATCH_INVALID") {
    super(code);
    this.name = "RelationshipSourceLedgerError";
  }
}
const unavailable = (): never => { throw new RelationshipSourceLedgerError("RELATIONSHIP_SOURCE_UNAVAILABLE"); };
const invalidBatch = (): never => { throw new RelationshipSourceLedgerError("RELATIONSHIP_SOURCE_BATCH_INVALID"); };
const validKey = (value: string) => typeof value === "string" && value.length > 0 && value.length <= 160;
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const sameScope = (left: RelationshipScope, right: RelationshipScope) => left.ownerId === right.ownerId && left.identityId === right.identityId && left.epoch === right.epoch;
const messageColumns = {
  id: schema.messages.id, userId: schema.messages.userId, identityId: schema.messages.identityId,
  conversationId: schema.messages.conversationId, characterId: schema.messages.characterId,
  role: schema.messages.role, status: schema.messages.status, sourceType: schema.messages.sourceType,
  generationId: schema.messages.generationId, clientMessageId: schema.messages.clientMessageId,
  replyToMessageId: schema.messages.replyToMessageId,
  createdAt: schema.messages.createdAt, completedAt: schema.messages.completedAt,
};

/**
 * Reads authoritative conversation receipts without reading private message text.
 * The caller must hold the identity/lifecycle lock and validate scope.epoch against its
 * persisted relationship head in the same transaction: conversation tables have no epoch.
 * sourceMetadata is server-owned segmentation, never model/client supplied; its scope and
 * exact source coverage are checked here. This loader neither infers episodes nor writes state.
 * Users remain unique real IDs even when multiple official turns reference them.
 * retainedUserMessageIds must come only from server-persisted accepted receipts. They allow
 * replay after an assistant was removed, confer no new turn/admission authority, and report
 * missing users without recreating their metadata. The repository proves this retained set.
 */
export async function loadRelationshipSourceLedger<TResult extends PgQueryResultHKT>(
  database: Database<TResult>,
  input: Readonly<{ scope: RelationshipScope; assistantMessageIds: readonly string[]; sourceMetadata: readonly RelationshipSourceMetadata[]; retainedUserMessageIds?: readonly string[] }>,
): Promise<NormalizedRelationshipReceipts> {
  const scope: RelationshipScope = { ownerId: input.scope.ownerId, identityId: input.scope.identityId, epoch: input.scope.epoch };
  const retainedIds = input.retainedUserMessageIds ?? [];
  if (!validKey(scope.epoch) || (!input.assistantMessageIds.length && !retainedIds.length) || !unique(input.assistantMessageIds) || !unique(retainedIds)) invalidBatch();
  if (!unique(input.sourceMetadata.map((item) => item.messageId)) || input.sourceMetadata.some((item) =>
    !sameScope(scope, item) || !validKey(item.sessionId) || !validKey(item.episodeId))) {
    throw new RelationshipSourceLedgerError("RELATIONSHIP_SOURCE_METADATA_INVALID");
  }
  const [identity] = await database.select({ id: schema.characterIdentities.id, stableKey: schema.characterIdentities.stableKey })
    .from(schema.characterIdentities).where(eq(schema.characterIdentities.id, scope.identityId));
  if (!identity) unavailable();
  const assistants = await database.select(messageColumns).from(schema.messages)
    .where(inArray(schema.messages.id, [...input.assistantMessageIds])).orderBy(asc(schema.messages.createdAt), asc(schema.messages.id));
  if (assistants.length !== input.assistantMessageIds.length) unavailable();
  const links = await database.select({
    assistantMessageId: schema.conversationReplySources.assistantMessageId,
    userMessageId: schema.conversationReplySources.userMessageId,
    userId: schema.conversationReplySources.userId, conversationId: schema.conversationReplySources.conversationId,
    position: schema.conversationReplySources.position,
  }).from(schema.conversationReplySources).where(inArray(schema.conversationReplySources.assistantMessageId, [...input.assistantMessageIds]))
    .orderBy(asc(schema.conversationReplySources.assistantMessageId), asc(schema.conversationReplySources.position));
  const linkedIds = [...new Set(links.map((link) => link.userMessageId))];
  const requestedUserIds = [...new Set([...linkedIds, ...retainedIds])];
  if (!requestedUserIds.length) invalidBatch();
  const users = await database.select(messageColumns).from(schema.messages).where(inArray(schema.messages.id, requestedUserIds));
  if (linkedIds.some((id) => !users.some((user) => user.id === id)) || users.some((user) => user.role !== "user")) unavailable();
  const userIds = users.map((user) => user.id);
  const missingRetainedUserMessageIds = retainedIds.filter((id) => !userIds.includes(id));
  if (input.sourceMetadata.some((item) => !requestedUserIds.includes(item.messageId)) || userIds.some((id) => !input.sourceMetadata.some((item) => item.messageId === id))) {
    throw new RelationshipSourceLedgerError("RELATIONSHIP_SOURCE_METADATA_INVALID");
  }
  const storedMessages = [...users, ...assistants];
  if (!unique(storedMessages.map((message) => message.id))) invalidBatch();
  const conversationIds = [...new Set(storedMessages.map((message) => message.conversationId))];
  const conversations = await database.select({ id: schema.conversations.id, userId: schema.conversations.userId, identityId: schema.conversations.identityId, characterId: schema.conversations.characterId })
    .from(schema.conversations).where(inArray(schema.conversations.id, conversationIds));
  const revisionIds = [...new Set([...storedMessages.map((message) => message.characterId), ...conversations.map((conversation) => conversation.characterId)].filter((id): id is string => !!id))];
  const revisions = await database.select({ id: schema.characters.id, stableKey: schema.characters.stableKey, version: schema.characters.characterVersion })
    .from(schema.characters).where(inArray(schema.characters.id, revisionIds));
  const revisionFor = (id: string | null) => revisions.find((revision) => revision.id === id);
  const messages: NormalizedRelationshipMessage[] = [];
  for (const row of storedMessages) {
    const conversation = conversations.find((item) => item.id === row.conversationId);
    const revision = revisionFor(row.characterId);
    if (row.userId !== scope.ownerId || row.identityId !== scope.identityId || !conversation || conversation.userId !== scope.ownerId || conversation.identityId !== scope.identityId ||
      revisionFor(conversation.characterId)?.stableKey !== identity.stableKey || (row.characterId !== null && (!revision || revision.stableKey !== identity.stableKey || revision.version < 1)) ||
      row.sourceType === "generation_tombstone" || !Number.isFinite(row.createdAt.getTime()) ||
      (row.completedAt !== null && (!Number.isFinite(row.completedAt.getTime()) || row.completedAt.getTime() < row.createdAt.getTime()))) unavailable();
    if (!(["user", "character"] as string[]).includes(row.role) || !( ["completed", "streaming", "cancelled", "failed", "withdrawn"] as string[]).includes(row.status)) unavailable();
    messages.push({ ...scope, id: row.id, conversationId: row.conversationId, role: row.role === "user" ? "user" : "assistant",
      status: row.status === "completed" ? "completed" : row.status === "streaming" ? "pending" : row.status === "withdrawn" ? "withdrawn" : "failed",
      generationId: row.generationId, characterVersion: revision?.version ?? null,
      createdAtMs: row.createdAt.getTime(), completedAtMs: row.completedAt?.getTime() ?? null,
    });
  }
  const turns: NormalizedRelationshipTurn[] = [];
  for (const assistant of assistants) {
    const generationId = assistant.generationId;
    const official = links.filter((link) => link.assistantMessageId === assistant.id);
    const officialIds = official.map((link) => link.userMessageId);
    if (assistant.role !== "character" || !generationId || assistant.clientMessageId !== `assistant-${generationId}` || !assistant.characterId ||
      assistant.status === "withdrawn" || (assistant.status === "completed" && (!assistant.completedAt || !Number.isFinite(assistant.completedAt.getTime())))) return unavailable();
    if (!official.length || official.length > 20 || !unique(officialIds) || officialIds.at(-1) !== assistant.replyToMessageId || official.some((link, position) =>
      link.position !== position || link.userId !== scope.ownerId || link.conversationId !== assistant.conversationId ||
      !users.some((user) => user.id === link.userMessageId && user.role === "user" && user.conversationId === assistant.conversationId))) invalidBatch();
    const version = revisionFor(assistant.characterId)?.version;
    if (!version) return unavailable();
    const batchComplete = officialIds.every((id) => users.find((user) => user.id === id)?.status === "completed");
    turns.push({ ...scope, id: assistant.id, assistantMessageId: assistant.id, conversationId: assistant.conversationId,
      generationId, userMessageIds: officialIds, characterVersion: version,
      status: !batchComplete ? "failed" : assistant.status === "completed" ? "completed" : assistant.status === "streaming" ? "pending" : "failed",
    });
  }
  return { scope, messages, turns, missingRetainedUserMessageIds, sourceMetadata: userIds.map((id) => {
    const metadata = input.sourceMetadata.find((item) => item.messageId === id)!;
    return { ...scope, messageId: id, sessionId: metadata.sessionId, episodeId: metadata.episodeId };
  }) };
}
