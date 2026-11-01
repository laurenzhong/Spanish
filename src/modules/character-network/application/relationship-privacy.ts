import type { RelationshipState } from "../domain/relationship-state";
import { rotateRelationshipEpochInUnitOfWork, type RelationshipUnitScope } from "./relationship-transaction";

export type RelationshipExportDto = Readonly<{
  schemaVersion: 1;
  characterKey: string; ruleVersion: string;
  familiarity: RelationshipState["familiarity"]; userRomanticIntent: RelationshipState["userRomanticIntent"];
  characterProposal: RelationshipState["characterProposal"]; interactionSafety: RelationshipState["interactionSafety"];
  boundaryRevision: number;
  boundaries: readonly Readonly<{ scope: string; target: string; status: string }>[];
  evidence: readonly Readonly<{ kind: string; certainty?: string; sequence: number; sessionId: string; episodeId: string; sourceMessageIds: readonly string[] }>[];
  truncated: boolean;
}>;
export type RelationshipExportInput = Readonly<{ state: RelationshipState; characterKey: string; limit?: number; sourceStatus?: Readonly<Record<string, "live" | "deleted" | "withdrawn">> }>;

export type PersistedRelationshipExportEvent = Readonly<{
  kind: string;
  certainty: string;
  sequence: number;
  turnId: string | null;
  episodeId: string | null;
  sessionId: string | null;
  sourceMessageIds: readonly string[];
}>;
export type PersistedRelationshipExportInput = Readonly<{
  characterKey: string;
  ruleVersion: string;
  boundaryRevision: number;
  boundaries: readonly Readonly<{ scope: string; target: string; status: string }>[];
  events: readonly PersistedRelationshipExportEvent[];
  limit?: number;
}>;

/** Privacy reset is deliberately a UoW-only operation; it rotates the epoch and cascades old children. */
export async function clearRelationshipDataInUnitOfWork<TResult extends import("drizzle-orm/pg-core").PgQueryResultHKT>(context: Readonly<{ transaction: ReturnType<typeof import("./../repositories/relationship-persistence-repository").createRelationshipPersistenceTransaction<TResult>> }>, scope: RelationshipUnitScope, headId: string) {
  const replacement = await rotateRelationshipEpochInUnitOfWork(context, scope, headId);
  if (!replacement) throw new Error("RELATIONSHIP_RESET_FAILED");
  return { epoch: replacement.epoch, headId: replacement.id };
}

export function toRelationshipExportDto(input: RelationshipExportInput): RelationshipExportDto {
  const { state } = input;
  if (!input.characterKey || !state.ruleVersion || !Number.isSafeInteger(state.boundaryRevision) || state.boundaryRevision < 0) throw new Error("RELATIONSHIP_EXPORT_INVALID");
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("RELATIONSHIP_EXPORT_INVALID");
  const status = input.sourceStatus ?? {};
  const evidence = state.evidence.filter((event) => event.sourceMessageIds.some((id) => status[id] !== "deleted" && status[id] !== "withdrawn")).slice(0, limit)
    .map((event) => ({ kind: event.kind, sequence: event.sequence, sessionId: event.sessionId, episodeId: event.episodeId, sourceMessageIds: event.sourceMessageIds.filter((id) => status[id] === "live" || status[id] === undefined) }));
  return { schemaVersion: 1, characterKey: input.characterKey, ruleVersion: state.ruleVersion, familiarity: state.familiarity, userRomanticIntent: state.userRomanticIntent, characterProposal: state.characterProposal, interactionSafety: state.interactionSafety, boundaryRevision: state.boundaryRevision, boundaries: state.boundaries.map(({ scope, target }) => ({ scope, target, status: "active" })), evidence, truncated: state.evidence.length > limit };
}

/**
 * Conservative projection used by account export until the full relationship
 * reducer is wired into the ordinary/proactive conversation UoW. It exposes
 * only persisted event metadata and never treats event count as intimacy.
 */
export function toPersistedRelationshipExportDto(input: PersistedRelationshipExportInput): RelationshipExportDto {
  if (!input.characterKey || !input.ruleVersion || !Number.isSafeInteger(input.boundaryRevision) || input.boundaryRevision < 0) throw new Error("RELATIONSHIP_EXPORT_INVALID");
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("RELATIONSHIP_EXPORT_INVALID");
  const events = [...input.events].sort((left, right) => left.sequence - right.sequence);
  const kinds = events.map((event) => event.kind);
  const latest = (...wanted: readonly string[]) => [...events].reverse().find((event) => wanted.includes(event.kind));
  const hasAnchor = kinds.includes("voluntary_personal_anchor");
  const hasWelcome = kinds.includes("mutual_conversation_welcome");
  const hasReturn = kinds.includes("user_continuity_return");
  const hasTrust = kinds.includes("user_trust_or_value");
  const hasPositive = kinds.includes("shared_positive_exchange") || kinds.includes("boundary_respected_and_return");
  const familiarity = hasAnchor && hasWelcome && hasReturn && hasTrust && hasPositive
    ? "close_friend" as const
    : hasAnchor && hasWelcome && hasReturn ? "familiar" as const
    : hasAnchor && (hasWelcome || hasReturn) ? "getting_to_know_you" as const
    : "new_contact" as const;
  const intentEvent = latest("explicit_friend_boundary", "explicit_romantic_confirmation", "explicit_romantic_openness", "user_romantic_declaration", "character_romantic_acceptance");
  const userRomanticIntent = intentEvent?.kind === "explicit_friend_boundary" ? "friends_only" as const
    : intentEvent && ["explicit_romantic_confirmation", "character_romantic_acceptance"].includes(intentEvent.kind) ? "confirmed" as const
    : intentEvent ? "open" as const : "unspecified" as const;
  const proposalEvent = latest("character_romantic_acceptance", "character_relationship_proposal", "character_interest_signal");
  const characterProposal = proposalEvent?.kind === "character_romantic_acceptance" ? "confirmed" as const
    : proposalEvent?.kind === "character_relationship_proposal" ? "confirmation_pending" as const
    : proposalEvent ? "interest_expressed" as const : "none" as const;
  const interactionSafety = kinds.includes("conflict_reported") && !kinds.includes("repair_acknowledged") ? "unresolved_conflict" as const : "comfortable" as const;
  const boundaries = input.boundaries.map((boundary) => ({ scope: boundary.scope, target: boundary.target, status: boundary.status }));
  const evidence = events.slice(0, limit).map((event) => ({
    kind: event.kind, certainty: event.certainty, sequence: event.sequence,
    sessionId: event.sessionId ?? "persisted", episodeId: event.episodeId ?? "persisted",
    sourceMessageIds: [...event.sourceMessageIds],
  }));
  return {
    schemaVersion: 1, characterKey: input.characterKey, ruleVersion: input.ruleVersion,
    familiarity, userRomanticIntent, characterProposal, interactionSafety,
    boundaryRevision: input.boundaryRevision, boundaries, evidence,
    truncated: events.length > limit,
  };
}
