/** Segmentation metadata only: elapsed time never creates relationship evidence. */
export const RELATIONSHIP_SESSION_GAP_MS = 4 * 60 * 60 * 1000;

type Scope = Readonly<{ ownerId: string; identityId: string; epoch: string }>;
export type RelationshipSessionCursor = Scope & Readonly<{
  sessionId: string;
  lastUserMessageId: string;
  lastUserMessageAtMs: number;
  lastSequence: number;
}>;
export type RelationshipSessionSource = Scope & Readonly<{
  id: string;
  role: "user";
  status: "completed";
  createdAtMs: number;
  sequence: number;
}>;
const validId = (id: string): boolean => typeof id === "string" && /^[a-zA-Z0-9._:-]{1,160}$/u.test(id);
const timestamp = (value: number): boolean => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const sequence = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
const sameScope = (left: Scope, right: Scope): boolean => left.ownerId === right.ownerId && left.identityId === right.identityId && left.epoch === right.epoch;

/**
 * Called under the owner/identity lock with persisted server metadata. The caller
 * stores this cursor with the user source; it must not rebuild it from a clipped
 * recent-history window or accept a model/client supplied session ID.
 * Only user activity extends a session, so proactive messages cannot keep one
 * open indefinitely. A completed user message may carry a restriction even when
 * its later assistant generation fails; this cursor is not a completed-turn fact.
 */
export function nextRelationshipSession(input: Readonly<{
  scope: Scope;
  previous?: RelationshipSessionCursor;
  message: RelationshipSessionSource;
}>): RelationshipSessionCursor {
  const { scope, previous, message } = input;
  if (![scope.ownerId, scope.identityId, scope.epoch, message.id].every(validId)
    || !sameScope(scope, message) || message.role !== "user" || message.status !== "completed"
    || !timestamp(message.createdAtMs) || !sequence(message.sequence)) throw new Error("INVALID_RELATIONSHIP_SOURCE");
  if (previous) {
    if (!sameScope(scope, previous) || !validId(previous.lastUserMessageId)
      || !/^relationship-session:[a-zA-Z0-9._:-]{1,160}$/u.test(previous.sessionId)
      || !timestamp(previous.lastUserMessageAtMs) || !sequence(previous.lastSequence)) throw new Error("INVALID_RELATIONSHIP_SESSION");
    if (message.sequence === previous.lastSequence) {
      if (message.id !== previous.lastUserMessageId || message.createdAtMs !== previous.lastUserMessageAtMs) {
        throw new Error("RELATIONSHIP_SOURCE_CONFLICT");
      }
      return {
        ownerId: scope.ownerId, identityId: scope.identityId, epoch: scope.epoch,
        sessionId: previous.sessionId, lastUserMessageId: previous.lastUserMessageId,
        lastUserMessageAtMs: previous.lastUserMessageAtMs, lastSequence: previous.lastSequence,
      };
    }
    if (message.sequence < previous.lastSequence || message.createdAtMs < previous.lastUserMessageAtMs) {
      throw new Error("STALE_RELATIONSHIP_SOURCE");
    }
    if (message.id === previous.lastUserMessageId) throw new Error("RELATIONSHIP_SOURCE_CONFLICT");
  }
  const fresh = !previous || message.createdAtMs - previous.lastUserMessageAtMs >= RELATIONSHIP_SESSION_GAP_MS;
  return {
    ownerId: scope.ownerId, identityId: scope.identityId, epoch: scope.epoch,
    sessionId: fresh ? `relationship-session:${message.id}` : previous.sessionId,
    lastUserMessageId: message.id,
    lastUserMessageAtMs: message.createdAtMs,
    lastSequence: message.sequence,
  };
}
