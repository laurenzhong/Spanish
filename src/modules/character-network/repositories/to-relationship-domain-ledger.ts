import type { RelationshipLedger, RelationshipScope, RelationshipSource } from "../domain/relationship-state";
import type { NormalizedRelationshipReceipts } from "./relationship-source-ledger";

const invalid = (): never => { throw new Error("RELATIONSHIP_SOURCE_PROJECTION_INVALID"); };
const unique = (ids: readonly string[]) => ids.length === new Set(ids).size;
const sameScope = (left: RelationshipScope, right: RelationshipScope) => left.ownerId === right.ownerId && left.identityId === right.identityId && left.epoch === right.epoch;

/**
 * Pure projection of locked, server-read receipts. It neither verifies the database
 * epoch nor invents episode/session identities. A user's original generation and
 * revision are audit metadata, not the authority for later reply membership.
 */
export function toRelationshipDomainLedger(input: NormalizedRelationshipReceipts): RelationshipLedger {
  const { scope, messages, turns, sourceMetadata } = input;
  if (!unique(messages.map(row => row.id)) || !unique(turns.map(row => row.id)) || !unique(sourceMetadata.map(row => row.messageId)) ||
    !unique(input.missingRetainedUserMessageIds) || input.missingRetainedUserMessageIds.some(id => messages.some(message => message.id === id)) ||
    [...messages, ...turns, ...sourceMetadata].some(row => !sameScope(scope, row))) invalid();
  const users = messages.filter(message => message.role === "user");
  if (sourceMetadata.length !== users.length || sourceMetadata.some(meta => !meta.sessionId || !meta.episodeId || !users.some(user => user.id === meta.messageId))) invalid();
  for (const turn of turns) {
    const assistant = messages.find(message => message.id === turn.assistantMessageId);
    if (!assistant || assistant.role !== "assistant" || assistant.conversationId !== turn.conversationId || assistant.generationId !== turn.generationId ||
      assistant.characterVersion !== turn.characterVersion || !turn.userMessageIds.length || !unique(turn.userMessageIds) ||
      turn.userMessageIds.some(id => !users.some(user => user.id === id && user.conversationId === turn.conversationId))) invalid();
    if (turn.status === "completed" && (assistant!.status !== "completed" || turn.userMessageIds.some(id => users.find(user => user.id === id)!.status !== "completed"))) invalid();
  }
  const projected: RelationshipSource[] = messages.map(message => {
    const base = { ownerId: scope.ownerId, identityId: scope.identityId, epoch: scope.epoch, id: message.id, role: message.role, status: message.status };
    if (message.role === "user") {
      const metadata = sourceMetadata.find(meta => meta.messageId === message.id);
      const memberships = turns.filter(turn => turn.userMessageIds.includes(message.id));
      if (!metadata) return invalid();
      return { ...base, role: "user", sessionId: metadata.sessionId, episodeId: metadata.episodeId, authoritativeTurnIds: memberships.map(turn => turn.id) };
    }
    const memberships = turns.filter(turn => turn.assistantMessageId === message.id);
    if (memberships.length !== 1) return invalid();
    const turn = memberships[0]!;
    const metadata = sourceMetadata.find(meta => meta.messageId === turn.userMessageIds.at(-1));
    if (!metadata) return invalid();
    return { ...base, role: "assistant", sessionId: metadata.sessionId, episodeId: metadata.episodeId,
      turnId: turn.id, generationId: turn.generationId, characterVersion: turn.characterVersion };
  });
  return {
    messages: projected,
    turns: turns.map(turn => ({ ownerId: scope.ownerId, identityId: scope.identityId, epoch: scope.epoch,
      id: turn.id, generationId: turn.generationId, userMessageIds: [...turn.userMessageIds], assistantMessageId: turn.assistantMessageId,
      status: turn.status, characterVersion: turn.characterVersion })),
  };
}
