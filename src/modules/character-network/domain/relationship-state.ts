/** Pure rules over server-owned receipts; this module does not classify natural language. */
export const RELATIONSHIP_RULE_VERSION = "relationship-v1" as const;
export type RelationshipScope = Readonly<{ ownerId: string; identityId: string; epoch: string }>;
export type RelationshipKind =
  | "voluntary_personal_anchor" | "user_continuity_return" | "mutual_conversation_welcome"
  | "user_trust_or_value" | "boundary_respected_and_return" | "shared_positive_exchange"
  | "explicit_romantic_openness" | "explicit_romantic_confirmation" | "user_romantic_declaration"
  | "explicit_friend_boundary" | "slow_down" | "conflict_reported" | "repair_acknowledged"
  | "contact_stop" | "contact_resume" | "boundary_set" | "boundary_release" | "explicit_relationship_reconfirmation"
  | "character_interest_signal" | "character_relationship_proposal" | "character_romantic_acceptance";
export type RelationshipBoundaryScope = "romance" | "nickname" | "topic" | "proactive" | "contact";
export type RelationshipSource = RelationshipScope & Readonly<{
  id: string;
  role: "user" | "assistant";
  status: "completed" | "pending" | "failed" | "deleted" | "withdrawn";
  /** Legacy fixture bindings. Canonical user messages can belong to several authoritative turns. */
  generationId?: string;
  turnId?: string;
  authoritativeTurnIds?: readonly string[];
  sessionId: string;
  /** Canonical server-owned episode, never an unvalidated model-supplied ID. */
  episodeId: string;
  characterVersion?: number;
}>;
export type RelationshipTurn = RelationshipScope & Readonly<{
  id: string; generationId: string; userMessageIds: readonly string[]; assistantMessageId: string;
  status: "completed" | "pending" | "failed"; characterVersion: number;
}>;
export type RelationshipLedger = Readonly<{ messages: readonly RelationshipSource[]; turns: readonly RelationshipTurn[] }>;
export type RelationshipCandidate = Readonly<{
  kind: RelationshipKind;
  sourceMessageIds: readonly string[];
  certainty: "explicit" | "supported" | "uncertain";
  /** Trusted application result, NEVER copied from a model boolean. Caller checked quotation, attribution, ambiguity and text support. */
  semanticVerified: boolean;
  relatedSourceMessageIds?: readonly string[];
  boundary?: Readonly<{ scope: RelationshipBoundaryScope; target: string }>;
  /** Every field requires a clear current-user instruction; never inferred from mere willingness to chat. */
  reconfirmation?: Readonly<{ romance: "friends_only"; contact: "resume" | "user_initiated_only" }>;
}>;
export type RelationshipPermit = RelationshipScope & Readonly<{
  boundaryRevision: number; userMessageId: string; generationId: string; turnId?: string;
  allowInterest: boolean; allowProposal: boolean; allowAcceptance: boolean;
}>;
export type RelationshipCommit = RelationshipScope & Readonly<{
  sequence: number;
  mode: "guard" | "completed";
  turnId: string;
  generationId: string;
  expectedBoundaryRevision: number;
  candidates: readonly RelationshipCandidate[];
  permit?: RelationshipPermit;
}>;
export type RelationshipCapabilities = Readonly<{ romance: boolean }>;
export type RelationshipEvidence = Readonly<{
  kind: RelationshipKind; sourceMessageIds: readonly string[]; relatedSourceMessageIds: readonly string[];
  sessionId: string; episodeId: string; sequence: number; turnId: string;
}>;
export type RelationshipState = RelationshipScope & Readonly<{
  ruleVersion: typeof RELATIONSHIP_RULE_VERSION;
  familiarity: "new_contact" | "getting_to_know_you" | "familiar" | "close_friend";
  userRomanticIntent: "unspecified" | "open" | "confirmed" | "friends_only" | "paused";
  characterProposal: "none" | "interest_expressed" | "confirmation_pending" | "confirmed";
  interactionSafety: "comfortable" | "uncertain" | "unresolved_conflict" | "reconfirmation_required";
  boundaryRevision: number;
  boundaries: readonly Readonly<{ scope: RelationshipBoundaryScope; target: string; sourceMessageIds: readonly string[] }>[];
  evidence: readonly RelationshipEvidence[];
  familiaritySequence: number;
  openSequence: number | null;
  openSessionId: string | null;
  reopenedSequence: number | null;
  lastProposalSequence: number | null;
  proactiveAllowed: boolean;
  /** Content-free deletion barrier, independent of conflict/uncertainty. */
  reconfirmationSequence: number | null;
}>;
export type ReduceRelationshipInput = Readonly<{
  scope: RelationshipScope; ledger: RelationshipLedger; commits: readonly RelationshipCommit[];
  capabilities: RelationshipCapabilities;
  /** Set by source deletion in the same identity transaction; contains no deleted content.
   * true means unknown ordering: install after all supplied commits, so historical intent cannot clear it.
   * A server receipt may supply afterSequence: install after that commit and bump boundaryRevision once.
   * Later explicit romantic opening/declaration or explicit_relationship_reconfirmation can clear it.
   * The latter keeps friends_only and explicitly chooses contact scope; ordinary conversation,
   * repair, friends_only alone or contact_resume alone cannot. A full epoch reset supplies no old marker.
   */
  invalidatedRestriction?: boolean | Readonly<{ afterSequence: number }>;
}>;
export type PreviewRelationshipInput = Readonly<{
  state: RelationshipState; ledger: RelationshipLedger; currentUserMessageId: string;
  /** Required to disambiguate normalized user sources reused across generations. */
  generationId?: string;
  expectedBoundaryRevision: number; capabilities: RelationshipCapabilities;
  /** Only an already-validated current-user declaration can authorize immediate acceptance. */
  declaration?: RelationshipCandidate;
}>;

/** Server-only durable admission receipt, never an LLM/client input. Contains accepted candidates only. */
export type AcceptedRelationshipReceipt = Readonly<{
  commit: RelationshipCommit;
  turn: RelationshipTurn;
  boundaryRevisionAfter: number;
}>;
export type ReplayAcceptedRelationshipInput = Readonly<{
  scope: RelationshipScope;
  ledger: RelationshipLedger;
  acceptedReceipts: readonly AcceptedRelationshipReceipt[];
  capabilities: RelationshipCapabilities;
  /** Monotonic control revision from the locked repository, never derived from surviving evidence. */
  boundaryRevision: number;
  invalidatedRestriction?: ReduceRelationshipInput["invalidatedRestriction"];
}>;
export type AdmitRelationshipCommitInput = ReplayAcceptedRelationshipInput & Readonly<{ commit: RelationshipCommit }>;

type MutableState = { -readonly [K in keyof RelationshipState]: RelationshipState[K] };
const restrictions = new Set<RelationshipKind>(["explicit_friend_boundary", "slow_down", "conflict_reported", "contact_stop", "boundary_set"]);
const assistantKinds = new Set<RelationshipKind>(["character_interest_signal", "character_relationship_proposal", "character_romantic_acceptance"]);
const explicitKinds = new Set<RelationshipKind>([...restrictions, ...assistantKinds, "explicit_romantic_openness", "explicit_romantic_confirmation", "user_romantic_declaration", "repair_acknowledged", "contact_resume", "boundary_release", "explicit_relationship_reconfirmation"]);
const allKinds = new Set<RelationshipKind>([...explicitKinds, "voluntary_personal_anchor", "user_continuity_return", "mutual_conversation_welcome", "user_trust_or_value", "boundary_respected_and_return", "shared_positive_exchange"]);
const sameScope = (left: RelationshipScope, right: RelationshipScope) => left.ownerId === right.ownerId && left.identityId === right.identityId && left.epoch === right.epoch;
const unique = (values: readonly string[]) => values.length === new Set(values).size;
const source = (ledger: RelationshipLedger, id: string) => ledger.messages.find((message) => message.id === id);
const live = (scope: RelationshipScope, message: RelationshipSource | undefined): message is RelationshipSource =>
  !!message && sameScope(scope, message) && message.status === "completed" && !!message.sessionId && !!message.episodeId;
const byKind = (state: RelationshipState, kind: RelationshipKind) => state.evidence.filter((event) => event.kind === kind);
const hasIndependent = (left: RelationshipEvidence, right: RelationshipEvidence) =>
  left.episodeId !== right.episodeId && !left.sourceMessageIds.some((id) => right.sourceMessageIds.includes(id));
const familiar = (state: RelationshipState) => state.familiarity === "familiar" || state.familiarity === "close_friend";
const romanceSafe = (state: RelationshipState, capabilities: RelationshipCapabilities) =>
  capabilities.romance && familiar(state) && state.interactionSafety === "comfortable" &&
  !["friends_only", "paused"].includes(state.userRomanticIntent) &&
  !state.boundaries.some((boundary) => boundary.scope === "romance" || boundary.scope === "contact");
const mutualSupport = (state: RelationshipState) => byKind(state, "mutual_conversation_welcome")
  .some((welcome) => byKind(state, "shared_positive_exchange").some((positive) => hasIndependent(welcome, positive)));
const afterReopen = (state: RelationshipState) => state.reopenedSequence === null || state.evidence.some((event) =>
  event.sequence > state.reopenedSequence! && ["user_continuity_return", "shared_positive_exchange", "mutual_conversation_welcome"].includes(event.kind) &&
  state.evidence.some((opening) => opening.sequence === state.reopenedSequence && ["explicit_romantic_openness", "user_romantic_declaration"].includes(opening.kind) && hasIndependent(opening, event)));

function validTurn(scope: RelationshipScope, ledger: RelationshipLedger, turnId: string, generationId: string): boolean {
  const turn = ledger.turns.find((item) => item.id === turnId);
  if (!turn || !sameScope(scope, turn) || turn.status !== "completed" || turn.generationId !== generationId || !turn.userMessageIds.length || !unique(turn.userMessageIds)) return false;
  return [...turn.userMessageIds, turn.assistantMessageId].every((id) => {
    const message = source(ledger, id);
    return live(scope, message) && belongsToTurn(message, turn) &&
      message.role === (id === turn.assistantMessageId ? "assistant" : "user");
  });
}

function belongsToTurn(message: RelationshipSource, turn: RelationshipTurn): boolean {
  if (!sameScope(message, turn)) return false;
  if (message.authoritativeTurnIds && !message.authoritativeTurnIds.includes(turn.id)) return false;
  if (message.role === "assistant") return message.id === turn.assistantMessageId &&
    (message.turnId === undefined || message.turnId === turn.id) &&
    (message.generationId === undefined || message.generationId === turn.generationId) &&
    (message.characterVersion === undefined || message.characterVersion === turn.characterVersion);
  return turn.userMessageIds.includes(message.id) &&
    (message.turnId === undefined || message.turnId === turn.id) &&
    (message.generationId === undefined || message.generationId === turn.generationId) &&
    (message.characterVersion === undefined || message.characterVersion === turn.characterVersion);
}

function candidateSources(scope: RelationshipScope, ledger: RelationshipLedger, candidate: RelationshipCandidate, turnId: string, generationId: string): RelationshipSource[] | null {
  if (candidate.semanticVerified !== true || !allKinds.has(candidate.kind) || !["explicit", "supported", "uncertain"].includes(candidate.certainty) || !candidate.sourceMessageIds.length || !unique(candidate.sourceMessageIds)) return null;
  const messages = candidate.sourceMessageIds.map((id) => source(ledger, id));
  const turn = ledger.turns.find((item) => item.id === turnId && item.generationId === generationId);
  if (!turn || !messages.every((message): message is RelationshipSource => live(scope, message) && belongsToTurn(message, turn) && message.role === (assistantKinds.has(candidate.kind) ? "assistant" : "user"))) return null;
  if (messages.some((message) => message.episodeId !== messages[0]!.episodeId || message.sessionId !== messages[0]!.sessionId)) return null;
  if (!(candidate.relatedSourceMessageIds ?? []).every((id) => live(scope, source(ledger, id)))) return null;
  return messages;
}

function currentUserReceipt(scope: RelationshipScope, ledger: RelationshipLedger, user: RelationshipSource | undefined, generationId?: string, turnId?: string): RelationshipTurn | null {
  if (!unique(ledger.messages.map((message) => message.id)) || !unique(ledger.turns.map((turn) => turn.id)) || !live(scope, user) || user.role !== "user") return null;
  const generation = generationId ?? user.generationId;
  if (!generation) return null;
  const turns = ledger.turns.filter((item) => item.generationId === generation && (!turnId || item.id === turnId) && item.userMessageIds.includes(user.id));
  const turn = turns.length === 1 ? turns[0] : undefined;
  return turn && sameScope(scope, turn) && ["pending", "completed"].includes(turn.status) &&
    unique(turn.userMessageIds) && belongsToTurn(user, turn) ? turn : null;
}

/** Read-only current-turn allowance; no evidence or intent is written by this function. */
export function previewRelationshipResponse(input: PreviewRelationshipInput): RelationshipPermit | null {
  const { state, ledger } = input;
  const user = source(ledger, input.currentUserMessageId);
  const turn = currentUserReceipt(state, ledger, user, input.generationId);
  if (!turn || !user || state.boundaryRevision !== input.expectedBoundaryRevision) return null;
  const safe = romanceSafe(state, input.capabilities) && mutualSupport(state) && afterReopen(state);
  const freshOpportunity = state.lastProposalSequence === null || (state.openSequence !== null && state.openSequence > state.lastProposalSequence);
  const declaration = input.declaration;
  const currentDeclaration = !!declaration && declaration.kind === "user_romantic_declaration" && declaration.certainty === "explicit" &&
    declaration.sourceMessageIds.includes(user.id) && !!candidateSources(state, ledger, declaration, turn.id, turn.generationId);
  const priorDeclaration = byKind(state, "user_romantic_declaration").some((event) => event.sequence === state.openSequence);
  const laterPositive = state.openSequence !== null && byKind(state, "shared_positive_exchange").some((event) =>
    event.sequence > state.openSequence! && event.sessionId !== state.openSessionId);
  return { ownerId: state.ownerId, identityId: state.identityId, epoch: state.epoch, boundaryRevision: state.boundaryRevision,
    userMessageId: user.id, generationId: turn.generationId, turnId: turn.id,
    allowInterest: safe && freshOpportunity && state.characterProposal !== "confirmed",
    allowProposal: safe && freshOpportunity && state.userRomanticIntent === "open" && laterPositive,
    allowAcceptance: safe && state.characterProposal !== "confirmed" && (currentDeclaration || (freshOpportunity && state.userRomanticIntent === "open" && priorDeclaration)),
  };
}

/** Freshness check only; issuance/semantic eligibility is recomputed at commit below. */
export function validateRelationshipResponsePermit(input: Readonly<{ state: RelationshipState; ledger: RelationshipLedger; permit: RelationshipPermit }>): boolean {
  const { state, ledger, permit } = input;
  const user = source(ledger, permit.userMessageId);
  return sameScope(state, permit) && state.boundaryRevision === permit.boundaryRevision && !!currentUserReceipt(state, ledger, user, permit.generationId, permit.turnId);
}

function refreshSafety(state: MutableState) {
  const unresolved = byKind(state, "conflict_reported").some((conflict) => !byKind(state, "repair_acknowledged").some((repair) =>
    repair.sequence > conflict.sequence && conflict.sourceMessageIds.some((id) => repair.relatedSourceMessageIds.includes(id))));
  if (state.reconfirmationSequence !== null) state.interactionSafety = "reconfirmation_required";
  else if (unresolved) state.interactionSafety = "unresolved_conflict";
}

function setBoundary(state: MutableState, scope: RelationshipBoundaryScope, target: string, ids: readonly string[]) {
  state.boundaries = [...state.boundaries.filter((boundary) => boundary.scope !== scope || boundary.target !== target), { scope, target, sourceMessageIds: [...ids] }];
}
function clearBoundary(state: MutableState, scope: RelationshipBoundaryScope, target?: string) {
  state.boundaries = state.boundaries.filter((boundary) => boundary.scope !== scope || (target !== undefined && boundary.target !== target));
}

function control(state: MutableState, event: RelationshipEvidence, candidate: RelationshipCandidate) {
  switch (event.kind) {
    case "explicit_relationship_reconfirmation":
      state.reconfirmationSequence = null;
      state.interactionSafety = "comfortable";
      state.userRomanticIntent = "friends_only";
      state.characterProposal = "none";
      state.openSequence = null;
      state.openSessionId = null;
      setBoundary(state, "romance", "all", event.sourceMessageIds);
      if (candidate.reconfirmation!.contact === "resume") clearBoundary(state, "contact");
      else setBoundary(state, "contact", "all", event.sourceMessageIds);
      state.boundaryRevision++;
      break;
    case "explicit_friend_boundary":
    case "slow_down":
      state.userRomanticIntent = event.kind === "slow_down" ? "paused" : "friends_only";
      state.characterProposal = "none";
      setBoundary(state, "romance", "all", event.sourceMessageIds);
      state.boundaryRevision++;
      break;
    case "contact_stop":
      setBoundary(state, "contact", "all", event.sourceMessageIds); state.boundaryRevision++; break;
    case "boundary_set":
      if (candidate.boundary) { setBoundary(state, candidate.boundary.scope, candidate.boundary.target, event.sourceMessageIds); state.boundaryRevision++; }
      break;
    case "boundary_release":
      if (candidate.boundary && candidate.boundary.scope !== "romance" && candidate.boundary.scope !== "contact") {
        clearBoundary(state, candidate.boundary.scope, candidate.boundary.target); state.boundaryRevision++;
      }
      break;
    case "contact_resume":
      clearBoundary(state, "contact"); state.boundaryRevision++;
      break;
    case "conflict_reported": state.interactionSafety = "unresolved_conflict"; state.boundaryRevision++; break;
    case "repair_acknowledged": {
      const conflicts = byKind(state, "conflict_reported");
      const repairs = byKind(state, "repair_acknowledged");
      const unresolved = conflicts.filter((conflict) => !repairs.some((repair) => conflict.sourceMessageIds.some((id) => repair.relatedSourceMessageIds.includes(id))));
      if (unresolved.length && unresolved.every((conflict) => conflict.sourceMessageIds.some((id) => event.relatedSourceMessageIds.includes(id)))) {
        state.interactionSafety = "comfortable"; state.boundaryRevision++;
      }
      break;
    }
    case "explicit_romantic_openness":
    case "user_romantic_declaration": {
      const reopening = state.userRomanticIntent === "friends_only" || state.userRomanticIntent === "paused" || state.interactionSafety === "reconfirmation_required";
      if (!reopening && state.userRomanticIntent === "confirmed" && state.characterProposal === "confirmed") break;
      if (reopening) { state.reopenedSequence = event.sequence; state.boundaryRevision++; }
      clearBoundary(state, "romance");
      state.userRomanticIntent = "open"; state.openSequence = event.sequence; state.openSessionId = event.sessionId;
      if (state.reconfirmationSequence !== null && event.sequence > state.reconfirmationSequence) state.reconfirmationSequence = null;
      if (state.interactionSafety === "reconfirmation_required" || state.interactionSafety === "uncertain") state.interactionSafety = "comfortable";
      break;
    }
  }
}

function advanceFriendship(state: MutableState, sequence: number) {
  // Only the user-initiated-only branch of explicit reconfirmation creates a contact boundary.
  // It forbids proactive contact while expressly allowing voluntary friendship; a later stop
  // replaces its source and therefore restores the ordinary contact-stop restriction.
  const contactStopsFriendship = state.boundaries.some((boundary) => boundary.scope === "contact" &&
    !byKind(state, "explicit_relationship_reconfirmation").some((event) => boundary.sourceMessageIds.length > 0 &&
      boundary.sourceMessageIds.every((id) => event.sourceMessageIds.includes(id))));
  if (state.interactionSafety !== "comfortable" || contactStopsFriendship) return;
  const fresh = state.evidence.filter((event) => event.sequence === sequence);
  if (!fresh.some((event) => ["voluntary_personal_anchor", "mutual_conversation_welcome", "user_continuity_return", "user_trust_or_value", "shared_positive_exchange", "boundary_respected_and_return"].includes(event.kind))) return;
  const anchors = byKind(state, "voluntary_personal_anchor");
  const welcomes = byKind(state, "mutual_conversation_welcome");
  const returns = byKind(state, "user_continuity_return").filter((event) => anchors.some((anchor) =>
    anchor.sequence < event.sequence && anchor.sessionId !== event.sessionId && hasIndependent(anchor, event) && anchor.sourceMessageIds.some((id) => event.relatedSourceMessageIds.includes(id))));
  let next = state.familiarity;
  if (state.familiarity === "new_contact" && anchors.length && (welcomes.length || returns.length)) next = "getting_to_know_you";
  else if (state.familiarity === "getting_to_know_you" && returns.some((event) => event.sequence > state.familiaritySequence && welcomes.some((welcome) => hasIndependent(welcome, event)))) next = "familiar";
  else if (state.familiarity === "familiar") {
    const trusts = byKind(state, "user_trust_or_value").filter((event) => event.sequence > state.familiaritySequence);
    const positives = state.evidence.filter((event) => ["shared_positive_exchange", "boundary_respected_and_return"].includes(event.kind) && event.sequence > state.familiaritySequence);
    if (trusts.some((trust) => positives.some((positive) => hasIndependent(trust, positive) && fresh.some((event) =>
      ["mutual_conversation_welcome", "user_continuity_return", "shared_positive_exchange"].includes(event.kind) &&
      event.sequence > Math.max(trust.sequence, positive.sequence) && event.sessionId !== trust.sessionId && event.sessionId !== positive.sessionId && hasIndependent(event, trust) && hasIndependent(event, positive))))) next = "close_friend";
  }
  if (next !== state.familiarity) { state.familiarity = next; state.familiaritySequence = sequence; }
}

/** Replays authoritative commit order. No time/turn count, text length or model score creates evidence. */
export function reduceRelationship(input: ReduceRelationshipInput): RelationshipState {
  return replayEngine(input);
}

/** Private execution mode: callers cannot disable admission CAS through public reducer options. */
function replayEngine(input: ReduceRelationshipInput, accepted?: ReadonlyMap<number, AcceptedRelationshipReceipt>, admission?: Readonly<{
  sequence: number; boundaryRevision: number; onAccepted: (candidate: RelationshipCandidate) => void;
}>): RelationshipState {
  const externalBarrierSequence = input.invalidatedRestriction === true
    ? Math.max(0, ...input.commits.filter((commit) => sameScope(input.scope, commit) && Number.isSafeInteger(commit.sequence)).map((commit) => commit.sequence))
    : input.invalidatedRestriction ? input.invalidatedRestriction.afterSequence : null;
  const state: MutableState = { ...input.scope, ruleVersion: RELATIONSHIP_RULE_VERSION,
    familiarity: "new_contact", userRomanticIntent: "unspecified", characterProposal: "none",
    interactionSafety: "comfortable",
    boundaryRevision: 0, boundaries: [], evidence: [], familiaritySequence: 0,
    openSequence: null, openSessionId: null, reopenedSequence: null, lastProposalSequence: null, proactiveAllowed: !input.invalidatedRestriction,
    reconfirmationSequence: null,
  };
  let externalBarrierApplied = false;
  const applyExternalBarrier = () => {
    if (externalBarrierApplied || externalBarrierSequence === null) return;
    externalBarrierApplied = true;
    state.reconfirmationSequence = Math.max(state.reconfirmationSequence ?? 0, externalBarrierSequence);
    state.interactionSafety = "reconfirmation_required";
    state.boundaryRevision++;
  };
  // Ambiguous authority is rejected, rather than letting array order choose ownership or receipts.
  if (!unique(input.ledger.messages.map((message) => message.id)) || !unique(input.ledger.turns.map((turn) => turn.id)) ||
    !unique(input.commits.filter((commit) => sameScope(state, commit)).map((commit) => String(commit.sequence)))) {
    return { ...state, interactionSafety: "reconfirmation_required", proactiveAllowed: false };
  }
  const seenTurns = new Set<string>();
  const seenSources = new Set<string>();
  const seenEpisodes = new Set<string>();
  const removedSourceKeys = new Set<string>();
  let previousSequence = -1;
  for (const commit of [...input.commits].sort((left, right) => left.sequence - right.sequence)) {
    if (!sameScope(state, commit) || !Number.isSafeInteger(commit.sequence) || commit.sequence < 1 || commit.sequence <= previousSequence || !["guard", "completed"].includes(commit.mode)) continue;
    previousSequence = commit.sequence;
    if (externalBarrierSequence !== null && commit.sequence > externalBarrierSequence) applyExternalBarrier();
    const historical = accepted?.get(commit.sequence);
    const ledger = historical ? {
      messages: input.ledger.messages.map((message) => message.role === "user" && historical.turn.userMessageIds.includes(message.id)
        ? { ...message, turnId: undefined, generationId: undefined, characterVersion: undefined, authoritativeTurnIds: undefined } : message),
      turns: [...input.ledger.turns.filter((turn) => turn.id !== commit.turnId), historical.turn],
    } : input.ledger;
    if (admission?.sequence === commit.sequence) state.boundaryRevision = admission.boundaryRevision;
    const receipt = ledger.turns.find((turn) => turn.id === commit.turnId);
    if (!receipt || !sameScope(state, receipt) || receipt.generationId !== commit.generationId) continue;
    const removedRestrictions = historical ? [] : commit.candidates.filter((candidate) => restrictions.has(candidate.kind) && candidate.semanticVerified && candidate.certainty === "explicit" && candidate.sourceMessageIds.length && !candidate.sourceMessageIds.some((id) => removedSourceKeys.has(`${candidate.kind}:${id}`)) && candidate.sourceMessageIds.some((id) => {
      const message = source(input.ledger, id);
      return !message || (sameScope(state, message) && (message.status === "deleted" || message.status === "withdrawn"));
    }));
    if (removedRestrictions.length) {
      // No deleted content survives. Preserve only a fail-closed safety state and revision ordering.
      state.interactionSafety = "reconfirmation_required";
      state.reconfirmationSequence = Math.max(state.reconfirmationSequence ?? 0, commit.sequence);
      state.boundaryRevision += removedRestrictions.length;
      removedRestrictions.forEach((candidate) => candidate.sourceMessageIds.forEach((id) => removedSourceKeys.add(`${candidate.kind}:${id}`)));
    }
    const incompleteHistoricalTurn = !!historical && commit.mode === "completed" && !validTurn(state, ledger, commit.turnId, commit.generationId);
    if (commit.mode === "completed") {
      if (seenTurns.has(commit.turnId) || (!historical && (commit.expectedBoundaryRevision !== state.boundaryRevision || !validTurn(state, ledger, commit.turnId, commit.generationId)))) continue;
      seenTurns.add(commit.turnId);
    }
    const before = { ...state, evidence: [...state.evidence], boundaries: [...state.boundaries] };
    const declaration = commit.candidates.find((candidate) => candidate.kind === "user_romantic_declaration");
    const replayPermit = historical && commit.permit ? { ...commit.permit, boundaryRevision: before.boundaryRevision } : commit.permit;
    const recomputed = replayPermit ? previewRelationshipResponse({ state: before, ledger, currentUserMessageId: replayPermit.userMessageId, generationId: commit.generationId, expectedBoundaryRevision: before.boundaryRevision, capabilities: input.capabilities, declaration }) : null;
    const permitValid = !!replayPermit && validateRelationshipResponsePermit({ state: before, ledger, permit: replayPermit }) && replayPermit.generationId === commit.generationId && currentUserReceipt(state, ledger, source(ledger, replayPermit.userMessageId), commit.generationId, commit.turnId)?.id === commit.turnId;
    // Restrictions first, independent of candidate extraction order.
    const priority = (kind: RelationshipKind) => restrictions.has(kind) ? 0 : assistantKinds.has(kind) ? 2 : 1;
    const candidates = commit.candidates.filter((candidate) => !incompleteHistoricalTurn || (restrictions.has(candidate.kind) && candidate.certainty === "explicit"))
      .sort((left, right) => priority(left.kind) - priority(right.kind));
    const restrictiveThisCommit = candidates.some((candidate) => restrictions.has(candidate.kind) && candidate.certainty === "explicit" && !!candidateSources(state, ledger, candidate, commit.turnId, commit.generationId));
    for (const candidate of candidates) {
      if (commit.mode === "guard" && !restrictions.has(candidate.kind)) continue;
      const messages = candidateSources(state, ledger, candidate, commit.turnId, commit.generationId);
      if (!messages) continue;
      const turn = ledger.turns.find((item) => item.id === commit.turnId);
      if (messages.some((message) => !turn || !(message.role === "assistant" ? turn.assistantMessageId === message.id : turn.userMessageIds.includes(message.id)))) continue;
      const first = messages[0]!;
      const sourceKeys = messages.map((message) => `${candidate.kind}:${message.id}`);
      const episodeKey = `${candidate.kind}:${first.episodeId}`;
      if (sourceKeys.some((key) => seenSources.has(key)) || (!explicitKinds.has(candidate.kind) && seenEpisodes.has(episodeKey))) continue;
      if (candidate.certainty === "uncertain") {
        if (state.interactionSafety === "comfortable") state.interactionSafety = "uncertain";
        if (admission?.sequence === commit.sequence) admission.onAccepted(candidate);
        state.boundaryRevision++; sourceKeys.forEach((key) => seenSources.add(key)); continue;
      }
      if (explicitKinds.has(candidate.kind) && candidate.certainty !== "explicit") continue;
      if (candidate.kind === "boundary_set" || candidate.kind === "boundary_release") {
        if (!candidate.boundary || !["romance", "nickname", "topic", "proactive", "contact"].includes(candidate.boundary.scope) ||
          typeof candidate.boundary.target !== "string" || !candidate.boundary.target.trim() || candidate.boundary.target.length > 160) continue;
      }
      if (candidate.kind === "explicit_relationship_reconfirmation" &&
        (state.reconfirmationSequence === null || commit.sequence <= state.reconfirmationSequence ||
          candidate.reconfirmation?.romance !== "friends_only" || !["resume", "user_initiated_only"].includes(candidate.reconfirmation.contact))) continue;
      const event: RelationshipEvidence = { kind: candidate.kind, sourceMessageIds: [...candidate.sourceMessageIds], relatedSourceMessageIds: [...(candidate.relatedSourceMessageIds ?? [])], sessionId: first.sessionId, episodeId: first.episodeId, sequence: commit.sequence, turnId: commit.turnId };
      if (assistantKinds.has(candidate.kind)) {
        if (!permitValid || !recomputed || restrictiveThisCommit || state.boundaryRevision !== before.boundaryRevision || !romanceSafe(state, input.capabilities)) continue;
        const field = candidate.kind === "character_interest_signal" ? "allowInterest" : candidate.kind === "character_relationship_proposal" ? "allowProposal" : "allowAcceptance";
        if (!commit.permit![field] || !recomputed[field]) continue;
        state.characterProposal = candidate.kind === "character_interest_signal" ? "interest_expressed" : candidate.kind === "character_relationship_proposal" ? "confirmation_pending" : "confirmed";
        state.lastProposalSequence = event.sequence;
        if (candidate.kind === "character_romantic_acceptance") state.userRomanticIntent = "confirmed";
      } else if (candidate.kind === "explicit_romantic_confirmation") {
        const proposal = byKind(state, "character_relationship_proposal").at(-1);
        if (restrictiveThisCommit || !romanceSafe(state, input.capabilities) || !afterReopen(state) || state.characterProposal !== "confirmation_pending" || !proposal ||
          (state.reopenedSequence !== null && proposal.sequence <= state.reopenedSequence) || !proposal.sourceMessageIds.some((id) => event.relatedSourceMessageIds.includes(id))) continue;
        state.characterProposal = "confirmed"; state.userRomanticIntent = "confirmed";
      } else {
        // A contradictory restriction wins this batch; a later complete user exchange can reopen it.
        if (restrictiveThisCommit && ["explicit_romantic_openness", "user_romantic_declaration", "contact_resume", "boundary_release", "repair_acknowledged", "explicit_relationship_reconfirmation"].includes(candidate.kind)) continue;
        control(state, event, candidate);
      }
      state.evidence = [...state.evidence, event];
      if (admission?.sequence === commit.sequence) admission.onAccepted(candidate);
      refreshSafety(state);
      sourceKeys.forEach((key) => seenSources.add(key)); seenEpisodes.add(episodeKey);
    }
    if (commit.mode === "completed" && !incompleteHistoricalTurn) advanceFriendship(state, commit.sequence);
  }
  applyExternalBarrier();
  state.proactiveAllowed = state.interactionSafety !== "reconfirmation_required" && !state.boundaries.some((boundary) => boundary.scope === "proactive" || boundary.scope === "contact");
  return state;
}

function validAcceptedHistory(input: ReplayAcceptedRelationshipInput): boolean {
  if (!Number.isSafeInteger(input.boundaryRevision) || input.boundaryRevision < 0 ||
    !unique(input.ledger.messages.map((message) => message.id)) || !unique(input.ledger.turns.map((turn) => turn.id)) ||
    !unique(input.acceptedReceipts.map((receipt) => String(receipt.commit.sequence)))) return false;
  const marker = input.invalidatedRestriction;
  if (marker && marker !== true && (!Number.isSafeInteger(marker.afterSequence) || marker.afterSequence < 0)) return false;
  let lastRevision = 0;
  for (const receipt of [...input.acceptedReceipts].sort((a, b) => a.commit.sequence - b.commit.sequence)) {
    const { commit, turn } = receipt;
    if (!sameScope(input.scope, commit) || !sameScope(input.scope, turn) || !Number.isSafeInteger(commit.sequence) || commit.sequence < 1 ||
      !Number.isSafeInteger(receipt.boundaryRevisionAfter) || receipt.boundaryRevisionAfter < lastRevision || receipt.boundaryRevisionAfter > input.boundaryRevision ||
      !Number.isSafeInteger(commit.expectedBoundaryRevision) || commit.expectedBoundaryRevision < 0 || commit.expectedBoundaryRevision > receipt.boundaryRevisionAfter ||
      !["guard", "completed"].includes(commit.mode) || commit.turnId !== turn.id || commit.generationId !== turn.generationId ||
      !["pending", "completed"].includes(turn.status) || (commit.mode === "completed" && turn.status !== "completed") ||
      !turn.userMessageIds.length || !unique(turn.userMessageIds) || turn.userMessageIds.includes(turn.assistantMessageId) ||
      !Number.isSafeInteger(turn.characterVersion) || turn.characterVersion < 1) return false;
    lastRevision = receipt.boundaryRevisionAfter;
    for (const candidate of commit.candidates) {
      if (!allKinds.has(candidate.kind) || candidate.semanticVerified !== true || !["explicit", "supported", "uncertain"].includes(candidate.certainty) ||
        !candidate.sourceMessageIds.length || !unique(candidate.sourceMessageIds) || (commit.mode === "guard" && !restrictions.has(candidate.kind)) ||
        candidate.sourceMessageIds.some((id) => assistantKinds.has(candidate.kind) ? id !== turn.assistantMessageId : !turn.userMessageIds.includes(id))) return false;
      for (const id of [...candidate.sourceMessageIds, ...(candidate.relatedSourceMessageIds ?? [])]) {
        const message = source(input.ledger, id);
        // Missing/deleted is privacy invalidation; wrong ownership is corrupt authority, not missing evidence.
        if (message && !sameScope(input.scope, message)) return false;
      }
      for (const id of candidate.sourceMessageIds) {
        const message = source(input.ledger, id);
        if (message && message.role !== (assistantKinds.has(candidate.kind) ? "assistant" : "user")) return false;
      }
    }
  }
  return true;
}

function failedAcceptedReplay(input: ReplayAcceptedRelationshipInput): RelationshipState {
  return { ...reduceRelationship({ scope: input.scope, ledger: { messages: [], turns: [] }, commits: [], capabilities: input.capabilities }),
    boundaryRevision: Number.isSafeInteger(input.boundaryRevision) && input.boundaryRevision >= 0 ? input.boundaryRevision : 0,
    interactionSafety: "reconfirmation_required", proactiveAllowed: false, reconfirmationSequence: 0 };
}

/** Repository-only projection of previously admitted receipts. Never use this as a write admission API. */
export function replayAcceptedRelationship(input: ReplayAcceptedRelationshipInput): RelationshipState {
  if (!validAcceptedHistory(input)) return failedAcceptedReplay(input);
  // A missing restrictive source without an explicit deletion receipt must fail closed AFTER history.
  const lostRestriction = input.acceptedReceipts.some(({ commit }) => commit.candidates.some((candidate) =>
    restrictions.has(candidate.kind) && candidate.sourceMessageIds.some((id) => !live(input.scope, source(input.ledger, id)))));
  const invalidatedRestriction = input.invalidatedRestriction ?? (lostRestriction ? true : undefined);
  const result = replayEngine({ ...input, commits: input.acceptedReceipts.map((receipt) => receipt.commit), invalidatedRestriction },
    new Map(input.acceptedReceipts.map((receipt) => [receipt.commit.sequence, receipt])));
  return { ...result, boundaryRevision: input.boundaryRevision };
}

/** Admit exactly one new server-validated commit under the repository's identity lock and CAS revision. */
export function admitRelationshipCommit(input: AdmitRelationshipCommitInput): Readonly<{ receipt: AcceptedRelationshipReceipt; state: RelationshipState }> | null {
  if (!validAcceptedHistory(input) || input.invalidatedRestriction === true) return null;
  const { commit } = input;
  const maxSequence = Math.max(0, ...input.acceptedReceipts.map((receipt) => receipt.commit.sequence),
    (input.invalidatedRestriction && typeof input.invalidatedRestriction === "object" ? input.invalidatedRestriction.afterSequence : 0));
  if (!sameScope(input.scope, commit) || !Number.isSafeInteger(commit.sequence) || commit.sequence <= maxSequence ||
    commit.expectedBoundaryRevision !== input.boundaryRevision || !["guard", "completed"].includes(commit.mode)) return null;
  const turn = input.ledger.turns.find((item) => item.id === commit.turnId);
  if (!turn || !sameScope(input.scope, turn) || turn.generationId !== commit.generationId ||
    !["pending", "completed"].includes(turn.status) || !turn.userMessageIds.length || !unique(turn.userMessageIds) ||
    turn.userMessageIds.includes(turn.assistantMessageId) || !Number.isSafeInteger(turn.characterVersion) || turn.characterVersion < 1 ||
    !turn.userMessageIds.every((id) => !!currentUserReceipt(input.scope, input.ledger, source(input.ledger, id), commit.generationId, commit.turnId)) ||
    (commit.mode === "completed" && !validTurn(input.scope, input.ledger, commit.turnId, commit.generationId))) return null;
  if (commit.mode === "completed" && input.acceptedReceipts.some((receipt) => receipt.commit.mode === "completed" && receipt.commit.turnId === commit.turnId)) return null;
  const acceptedCandidates: RelationshipCandidate[] = [];
  // Freeze unknown-order barriers at the end of accepted history, not after the new commit.
  const lostRestriction = input.acceptedReceipts.some(({ commit: old }) => old.candidates.some((candidate) =>
    restrictions.has(candidate.kind) && candidate.sourceMessageIds.some((id) => !live(input.scope, source(input.ledger, id)))));
  // A write needs a durable deletion position; a boolean/missing marker would move on the next read.
  if (lostRestriction && !input.invalidatedRestriction) return null;
  const invalidatedRestriction = input.invalidatedRestriction;
  const state = replayEngine({ ...input, commits: [...input.acceptedReceipts.map((receipt) => receipt.commit), commit], invalidatedRestriction },
    new Map(input.acceptedReceipts.map((receipt) => [receipt.commit.sequence, receipt])),
    { sequence: commit.sequence, boundaryRevision: input.boundaryRevision, onAccepted: (candidate) => acceptedCandidates.push(candidate) });
  if (!acceptedCandidates.length) return null;
  const receipt: AcceptedRelationshipReceipt = {
    commit: {
      ownerId: commit.ownerId, identityId: commit.identityId, epoch: commit.epoch, sequence: commit.sequence, mode: commit.mode,
      turnId: commit.turnId, generationId: commit.generationId, expectedBoundaryRevision: commit.expectedBoundaryRevision,
      candidates: acceptedCandidates.map((candidate) => ({
        kind: candidate.kind, sourceMessageIds: [...candidate.sourceMessageIds], certainty: candidate.certainty,
        semanticVerified: candidate.semanticVerified, ...(candidate.relatedSourceMessageIds ? { relatedSourceMessageIds: [...candidate.relatedSourceMessageIds] } : {}),
        ...(candidate.boundary ? { boundary: { scope: candidate.boundary.scope, target: candidate.boundary.target } } : {}),
        ...(candidate.reconfirmation ? { reconfirmation: { romance: candidate.reconfirmation.romance, contact: candidate.reconfirmation.contact } } : {}),
      })),
      ...(commit.permit ? { permit: {
        ownerId: commit.permit.ownerId, identityId: commit.permit.identityId, epoch: commit.permit.epoch,
        boundaryRevision: commit.permit.boundaryRevision, userMessageId: commit.permit.userMessageId, generationId: commit.permit.generationId,
        ...(commit.permit.turnId ? { turnId: commit.permit.turnId } : {}), allowInterest: commit.permit.allowInterest,
        allowProposal: commit.permit.allowProposal, allowAcceptance: commit.permit.allowAcceptance,
      } } : {}),
    },
    turn: { ownerId: turn.ownerId, identityId: turn.identityId, epoch: turn.epoch, id: turn.id, generationId: turn.generationId,
      userMessageIds: [...turn.userMessageIds], assistantMessageId: turn.assistantMessageId, status: turn.status, characterVersion: turn.characterVersion },
    boundaryRevisionAfter: state.boundaryRevision,
  };
  return { receipt, state };
}
