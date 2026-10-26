import { extractRelationshipCandidates, type RelationshipCompletionCandidate } from "../../src/modules/character-network/domain/relationship-candidate-extraction";
import {
  admitRelationshipCommit,
  previewRelationshipResponse,
  replayAcceptedRelationship,
  type AcceptedRelationshipReceipt,
  type RelationshipCandidate,
  type RelationshipKind,
  type RelationshipLedger,
  type RelationshipScope,
  type RelationshipSource,
  type RelationshipState,
  type RelationshipTurn,
} from "../../src/modules/character-network/domain/relationship-state";

export type EvaluationRelationshipMessage = Readonly<{
  id: string;
  role: "user" | "assistant";
  sessionId: string;
  episodeId: string;
  generationId: string;
  content: string;
}>;

export type EvaluationRelationshipProjection = Readonly<{
  scope: RelationshipScope;
  ledger: RelationshipLedger;
  receipts: readonly AcceptedRelationshipReceipt[];
  state: RelationshipState;
  acceptedKinds: readonly RelationshipKind[];
  rejectedKinds: readonly RelationshipKind[];
}>;

/** Rebind an isolated projection when a paused evaluation is forked. */
export function rebaseEvaluationRelationshipProjection(
  projection: EvaluationRelationshipProjection,
  scope: RelationshipScope,
): EvaluationRelationshipProjection {
  const copy = structuredClone(projection) as EvaluationRelationshipProjection;
  const rewrite = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "ownerId") (value as Record<string, unknown>)[key] = scope.ownerId;
      else rewrite(child);
    }
  };
  rewrite(copy);
  return copy;
}

export function createEvaluationRelationshipProjection(input: Readonly<{
  ownerId: string;
  identityId?: string;
  epoch?: string;
}>): EvaluationRelationshipProjection {
  const scope: RelationshipScope = {
    ownerId: input.ownerId,
    identityId: input.identityId ?? "lucia-evaluation",
    epoch: input.epoch ?? "evaluation-epoch-1",
  };
  const ledger: RelationshipLedger = { messages: [], turns: [] };
  return {
    scope,
    ledger,
    receipts: [],
    state: replayAcceptedRelationship({ scope, ledger, acceptedReceipts: [], capabilities: { romance: true }, boundaryRevision: 0 }),
    acceptedKinds: [],
    rejectedKinds: [],
  };
}

function source(scope: RelationshipScope, message: EvaluationRelationshipMessage): RelationshipSource {
  return {
    ...scope,
    id: message.id,
    role: message.role,
    status: "completed",
    generationId: message.generationId,
    turnId: `turn:${message.generationId}`,
    authoritativeTurnIds: [`turn:${message.generationId}`],
    sessionId: message.sessionId,
    episodeId: message.episodeId,
    characterVersion: 1,
  };
}

function candidate(input: RelationshipCompletionCandidate): RelationshipCandidate {
  return {
    ...input,
    semanticVerified: true,
    ...(input.boundary && input.boundary.scope !== "romance" && input.boundary.scope !== "contact"
      ? { boundary: { scope: input.boundary.scope, target: input.boundary.target } }
      : input.boundary),
  };
}

/**
 * Apply one completed user/assistant exchange to an isolated relationship
 * projection. This is evaluation infrastructure: it does not write product
 * tables and it never treats a partial or failed exchange as evidence.
 */
export function admitEvaluationRelationshipTurn(
  previous: EvaluationRelationshipProjection,
  input: Readonly<{
    user: EvaluationRelationshipMessage;
    assistant: EvaluationRelationshipMessage;
  }>,
): EvaluationRelationshipProjection {
  if (input.user.role !== "user" || input.assistant.role !== "assistant" || input.user.generationId !== input.assistant.generationId) {
    throw new Error("RELATIONSHIP_TURN_INVALID");
  }
  const turnId = `turn:${input.user.generationId}`;
  const turn: RelationshipTurn = {
    ...previous.scope,
    id: turnId,
    generationId: input.user.generationId,
    userMessageIds: [input.user.id],
    assistantMessageId: input.assistant.id,
    status: "completed",
    characterVersion: 1,
  };
  const ledger: RelationshipLedger = {
    messages: [...previous.ledger.messages, source(previous.scope, input.user), source(previous.scope, input.assistant)],
    turns: [...previous.ledger.turns, turn],
  };
  const rawCandidates = [
    ...extractRelationshipCandidates({ text: input.user.content, messageId: input.user.id, role: "user" }),
    ...extractRelationshipCandidates({ text: input.assistant.content, messageId: input.assistant.id, role: "assistant" }),
  ];
  const latestProposal = previous.state.evidence
    .filter((event) => event.kind === "character_relationship_proposal")
    .at(-1);
  const candidates = rawCandidates.map((raw) => candidate(raw.kind === "user_continuity_return"
    ? { ...raw, relatedSourceMessageIds: previous.ledger.messages.filter((message) => message.role === "user").map((message) => message.id) }
    : raw.kind === "explicit_romantic_confirmation" && latestProposal
      ? { ...raw, relatedSourceMessageIds: [...latestProposal.sourceMessageIds] }
      : raw));
  if (candidates.length === 0) return { ...previous, ledger, state: replayAcceptedRelationship({ scope: previous.scope, ledger, acceptedReceipts: previous.receipts, capabilities: { romance: true }, boundaryRevision: previous.state.boundaryRevision }) };

  const declaration = candidates.find((item) => item.kind === "user_romantic_declaration");
  const assistantCandidates = candidates.some((item) => item.sourceMessageIds.includes(input.assistant.id));
  const permit = assistantCandidates
    ? previewRelationshipResponse({
      state: previous.state,
      ledger,
      currentUserMessageId: input.user.id,
      generationId: input.user.generationId,
      expectedBoundaryRevision: previous.state.boundaryRevision,
      capabilities: { romance: true },
      declaration,
    }) ?? undefined
    : undefined;
  const commit = {
    ...previous.scope,
    sequence: previous.receipts.length + 1,
    mode: "completed" as const,
    turnId,
    generationId: input.user.generationId,
    expectedBoundaryRevision: previous.state.boundaryRevision,
    candidates,
    ...(permit ? { permit } : {}),
  };
  const admitted = admitRelationshipCommit({
    scope: previous.scope,
    ledger,
    acceptedReceipts: previous.receipts,
    capabilities: { romance: true },
    boundaryRevision: previous.state.boundaryRevision,
    commit,
  });
  if (!admitted) {
    return {
      ...previous,
      ledger,
      state: replayAcceptedRelationship({ scope: previous.scope, ledger, acceptedReceipts: previous.receipts, capabilities: { romance: true }, boundaryRevision: previous.state.boundaryRevision }),
      rejectedKinds: [...previous.rejectedKinds, ...candidates.map((item) => item.kind)],
    };
  }
  const accepted = admitted.receipt.commit.candidates.map((item) => item.kind);
  return {
    ...previous,
    ledger,
    receipts: [...previous.receipts, admitted.receipt],
    state: admitted.state,
    acceptedKinds: [...previous.acceptedKinds, ...accepted],
    rejectedKinds: [...previous.rejectedKinds, ...candidates.filter((item) => !accepted.includes(item.kind)).map((item) => item.kind)],
  };
}
