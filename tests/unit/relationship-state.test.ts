import { describe, expect, it } from "vitest";
import {
  reduceRelationship, previewRelationshipResponse, validateRelationshipResponsePermit,
  type RelationshipCandidate, type RelationshipCommit, type RelationshipLedger, type RelationshipScope,
} from "@/src/modules/character-network/domain/relationship-state";

const scope: RelationshipScope = { ownerId: "owner", identityId: "lucia", epoch: "epoch-1" };
function harness() {
  const ledger: { messages: RelationshipLedger["messages"][number][]; turns: RelationshipLedger["turns"][number][] } = { messages: [], turns: [] };
  const commits: RelationshipCommit[] = [];
  const state = () => reduceRelationship({ scope, ledger, commits, capabilities: { romance: true } });
  function turn(session: string, episode: string, kinds: RelationshipCandidate["kind"][], related: string[] = []) {
    const n = ledger.turns.length + 1;
    const id = `t${n}`, user = `u${n}`, assistant = `a${n}`, generation = `g${n}`;
    ledger.messages.push(...(["user", "assistant"] as const).map((role) => ({ ...scope, id: role === "user" ? user : assistant, role, status: "completed" as const, generationId: generation, turnId: id, sessionId: session, episodeId: episode, characterVersion: 4 })));
    ledger.turns.push({ ...scope, id, generationId: generation, userMessageIds: [user], assistantMessageId: assistant, status: "completed", characterVersion: 4 });
    const candidates: RelationshipCandidate[] = kinds.map((kind) => ({ kind, sourceMessageIds: [kind.startsWith("character_") ? assistant : user], relatedSourceMessageIds: related, certainty: "explicit", semanticVerified: true }));
    const prior = state();
    const permit = previewRelationshipResponse({ state: prior, ledger, currentUserMessageId: user, expectedBoundaryRevision: prior.boundaryRevision, capabilities: { romance: true }, declaration: candidates.find((candidate) => candidate.kind === "user_romantic_declaration") }) ?? undefined;
    commits.push({ ...scope, sequence: n, mode: "completed", turnId: id, generationId: generation, expectedBoundaryRevision: prior.boundaryRevision, candidates, permit });
    return { user, assistant, state: state() };
  }
  return { ledger, commits, state, turn };
}

describe("source-driven relationship rules", () => {
  it("reaches friendship from empty through independent voluntary episodes", () => {
    const h = harness();
    expect(h.state().familiarity).toBe("new_contact");
    const first = h.turn("s1", "e1", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    expect(first.state.familiarity).toBe("getting_to_know_you");
    expect(h.turn("s2", "e2", ["user_continuity_return"], [first.user]).state.familiarity).toBe("familiar");
    h.turn("s3", "e3", ["user_trust_or_value"]);
    h.turn("s3", "e4", ["shared_positive_exchange"]);
    expect(h.turn("s4", "e5", ["mutual_conversation_welcome"]).state.familiarity).toBe("close_friend");
    expect(h.state()).toEqual(h.state());
  });

  it("permits current-user confession response without prematurely committing it", () => {
    const h = harness();
    const first = h.turn("s1", "e1", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    h.turn("s2", "e2", ["user_continuity_return", "shared_positive_exchange"], [first.user]);
    const result = h.turn("s3", "e3", ["user_romantic_declaration", "character_romantic_acceptance"]);
    expect(result.state.userRomanticIntent).toBe("confirmed");
    expect(result.state.characterProposal).toBe("confirmed");
    const permit = h.commits.at(-1)!.permit!;
    expect(validateRelationshipResponsePermit({ state: result.state, ledger: h.ledger, permit })).toBe(true);
  });

  it("allows character-first interest, later proposal and explicit user acceptance", () => {
    const h = harness();
    const first = h.turn("s1", "e1", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    h.turn("s2", "e2", ["user_continuity_return", "shared_positive_exchange"], [first.user]);
    expect(h.turn("s3", "e3", ["character_interest_signal"]).state.characterProposal).toBe("interest_expressed");
    h.turn("s3", "e4", ["explicit_romantic_openness"]);
    h.turn("s4", "e5", ["shared_positive_exchange"]);
    const proposal = h.turn("s4", "e6", ["character_relationship_proposal"]);
    expect(proposal.state.characterProposal).toBe("confirmation_pending");
    expect(h.turn("s5", "e7", ["explicit_romantic_confirmation"], [proposal.assistant]).state.userRomanticIntent).toBe("confirmed");
  });

  it("preserves friends-only through warm interaction and rejects replay promotion", () => {
    const h = harness();
    h.turn("s1", "e1", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    h.turn("s2", "e2", ["explicit_friend_boundary"]);
    h.turn("s3", "e3", ["shared_positive_exchange"]);
    expect(h.state().userRomanticIntent).toBe("friends_only");
    const prior = h.state();
    h.commits.push({ ...h.commits[0]!, sequence: 4, expectedBoundaryRevision: prior.boundaryRevision });
    expect(h.state().familiarity).toBe(prior.familiarity);
  });

  it("applies persisted user restrictions even if their generation never completes", () => {
    const h = harness();
    h.turn("s1", "e1", []);
    const commit = h.commits[0]!;
    h.ledger.turns[0] = { ...h.ledger.turns[0]!, status: "failed" };
    h.ledger.messages[1] = { ...h.ledger.messages[1]!, status: "failed" };
    h.commits[0] = { ...commit, mode: "guard", candidates: [{ kind: "contact_stop", sourceMessageIds: ["u1"], certainty: "explicit", semanticVerified: true }] };
    expect(h.state().proactiveAllowed).toBe(false);
    expect(h.state().familiarity).toBe("new_contact");
  });

  it("does not let a second uncertainty erase an unresolved conflict", () => {
    const h = harness();
    h.turn("s1", "e1", ["conflict_reported"]);
    h.turn("s2", "e2", ["mutual_conversation_welcome"]);
    h.commits[1] = { ...h.commits[1]!, candidates: h.commits[1]!.candidates.map((candidate) => ({ ...candidate, certainty: "uncertain" })) };
    expect(h.state().interactionSafety).toBe("unresolved_conflict");
  });

  it("does not let repeated episode dedup swallow a new stop after resume", () => {
    const h = harness();
    h.turn("s1", "e1", ["contact_stop"]);
    h.turn("s2", "e2", ["contact_resume"]);
    h.turn("s3", "e1", ["contact_stop"]);
    expect(h.state().proactiveAllowed).toBe(false);
  });

  it("keeps deletion of restriction sources conservative without retaining deleted intent", () => {
    const h = harness();
    h.turn("s1", "e1", ["explicit_friend_boundary"]);
    h.ledger.messages[0] = { ...h.ledger.messages[0]!, status: "deleted" };
    expect(h.state().interactionSafety).toBe("reconfirmation_required");
    expect(h.state().userRomanticIntent).toBe("unspecified");
    expect(h.state().boundaries).toEqual([]);
    expect(h.state().proactiveAllowed).toBe(false);
  });

  it("rejects candidates referencing a completed message outside the authoritative turn receipt", () => {
    const h = harness();
    h.turn("s1", "e1", []);
    h.ledger.messages.push({ ...h.ledger.messages[0]!, id: "unclaimed" });
    h.commits[0] = { ...h.commits[0]!, candidates: ["voluntary_personal_anchor", "mutual_conversation_welcome"].map((kind) => ({ kind: kind as RelationshipCandidate["kind"], sourceMessageIds: ["unclaimed"], semanticVerified: true, certainty: "explicit" })) };
    expect(h.state().familiarity).toBe("new_contact");
  });

  it("does not let candidate order overwrite a paired user-first confirmation", () => {
    const h = harness();
    const first = h.turn("s1", "e1", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    h.turn("s2", "e2", ["user_continuity_return", "shared_positive_exchange"], [first.user]);
    expect(h.turn("s3", "e3", ["character_romantic_acceptance", "user_romantic_declaration"]).state.userRomanticIntent).toBe("confirmed");
  });

  it("requires repairing every unresolved conflict rather than only the latest", () => {
    const h = harness();
    const first = h.turn("s1", "e1", ["conflict_reported"]);
    const second = h.turn("s2", "e2", ["conflict_reported"]);
    expect(h.turn("s3", "e3", ["repair_acknowledged"], [second.user]).state.interactionSafety).toBe("unresolved_conflict");
    expect(h.turn("s4", "e4", ["repair_acknowledged"], [first.user]).state.interactionSafety).toBe("comfortable");
  });

  it("fails closed on ambiguous commit order independently of input order", () => {
    const h = harness();
    h.turn("s1", "e1", ["contact_stop"]);
    h.turn("s2", "e2", ["contact_resume"]);
    h.commits[1] = { ...h.commits[1]!, sequence: 1 };
    const forward = h.state();
    h.commits.reverse();
    expect(h.state()).toEqual(forward);
    expect(forward.interactionSafety).toBe("reconfirmation_required");
    expect(forward.proactiveAllowed).toBe(false);
  });

  it.each([{ mode: "unknown" }, { sequence: 0 }, { sequence: -1 }, { sequence: 1.5 }])("rejects malformed receipt metadata %j", (patch) => {
    const h = harness();
    h.turn("s1", "e1", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    Object.assign(h.commits[0]!, patch);
    expect(h.state().familiarity).toBe("new_contact");
  });

  it("rejects unknown candidate kinds rather than retaining them as accepted evidence", () => {
    const h = harness();
    h.turn("s1", "e1", ["voluntary_personal_anchor"]);
    Object.assign(h.commits[0]!.candidates[0]!, { kind: "model_says_in_love" });
    expect(h.state().evidence).toEqual([]);
  });

  it("does not let historical openness or repaired conflict erase a deletion barrier", () => {
    const h = harness();
    h.turn("s1", "e1", ["explicit_romantic_openness"]);
    const conflict = h.turn("s2", "e2", ["conflict_reported"]);
    h.turn("s3", "e3", ["repair_acknowledged"], [conflict.user]);
    const state = reduceRelationship({ scope, ledger: h.ledger, commits: h.commits, capabilities: { romance: true }, invalidatedRestriction: true });
    expect(state.interactionSafety).toBe("reconfirmation_required");
    expect(state.proactiveAllowed).toBe(false);
    expect(state.boundaryRevision).toBe(h.state().boundaryRevision + 1);
  });

  it("lets a genuinely newer explicit instruction resolve a sequenced deletion barrier", () => {
    const h = harness();
    h.turn("s1", "e1", ["mutual_conversation_welcome"]);
    h.turn("s2", "e2", ["explicit_romantic_openness"]);
    h.commits[1] = { ...h.commits[1]!, expectedBoundaryRevision: 1 };
    const state = reduceRelationship({ scope, ledger: h.ledger, commits: h.commits, capabilities: { romance: true }, invalidatedRestriction: { afterSequence: 1 } });
    expect(state.userRomanticIntent).toBe("open");
    expect(state.interactionSafety).toBe("comfortable");
    expect(state.reconfirmationSequence).toBeNull();
  });

  it("rejects unknown boundary scopes instead of accepting an ineffective restriction", () => {
    const h = harness();
    h.turn("s1", "e1", []);
    h.commits[0] = { ...h.commits[0]!, candidates: [{ kind: "boundary_set", sourceMessageIds: ["u1"], certainty: "explicit", semanticVerified: true, boundary: { scope: "unknown" as "contact", target: "all" } }] };
    expect(h.state().boundaries).toEqual([]);
    expect(h.state().evidence).toEqual([]);
  });

  it("allows a qualified current declaration after an unanswered character interest signal", () => {
    const h = harness();
    const first = h.turn("s1", "e1", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    h.turn("s2", "e2", ["user_continuity_return", "shared_positive_exchange"], [first.user]);
    h.turn("s3", "e3", ["character_interest_signal"]);
    expect(h.turn("s4", "e4", ["user_romantic_declaration", "character_romantic_acceptance"]).state.userRomanticIntent).toBe("confirmed");
    expect(h.turn("s5", "e5", ["user_romantic_declaration"]).state.userRomanticIntent).toBe("confirmed");
  });

  it.each(["resume", "user_initiated_only"] as const)("allows explicit friendship reconfirmation with contact=%s", (contact) => {
    const h = harness();
    h.turn("s1", "e1", []);
    h.turn("s2", "e2", []);
    h.commits[1] = { ...h.commits[1]!, expectedBoundaryRevision: 1, candidates: [{ kind: "explicit_relationship_reconfirmation", sourceMessageIds: ["u2"], semanticVerified: true, certainty: "explicit", reconfirmation: { romance: "friends_only", contact } }] };
    const state = reduceRelationship({ scope, ledger: h.ledger, commits: h.commits, capabilities: { romance: true }, invalidatedRestriction: { afterSequence: 1 } });
    expect(state.interactionSafety).toBe("comfortable");
    expect(state.userRomanticIntent).toBe("friends_only");
    expect(state.proactiveAllowed).toBe(contact === "resume");
    expect(state.boundaries.some((boundary) => boundary.scope === "romance")).toBe(true);
  });

  it.each([
    { certainty: "supported" }, { certainty: "uncertain" }, { mode: "guard" },
    { reconfirmation: undefined }, { reconfirmation: { romance: "friends_only", contact: "unknown" } },
  ])("does not relax a deletion barrier with incomplete or untrusted reconfirmation %j", (patch) => {
    const h = harness();
    h.turn("s1", "e1", []);
    h.turn("s2", "e2", []);
    const candidate = { kind: "explicit_relationship_reconfirmation", sourceMessageIds: ["u2"], semanticVerified: true, certainty: "explicit", reconfirmation: { romance: "friends_only", contact: "resume" }, ...patch } as RelationshipCandidate;
    h.commits[1] = { ...h.commits[1]!, expectedBoundaryRevision: 1, mode: "mode" in patch ? "guard" : "completed", candidates: [candidate] };
    const state = reduceRelationship({ scope, ledger: h.ledger, commits: h.commits, capabilities: { romance: true }, invalidatedRestriction: { afterSequence: 1 } });
    expect(state.interactionSafety).toBe("reconfirmation_required");
    expect(state.proactiveAllowed).toBe(false);
  });

  it.each(["explicit_friend_boundary", "contact_resume", "explicit_relationship_reconfirmation"] as const)("does not let historical %s erase a newer unknown deletion barrier", (kind) => {
    const h = harness();
    h.turn("s1", "e1", []);
    h.commits[0] = { ...h.commits[0]!, candidates: [{ kind, sourceMessageIds: ["u1"], semanticVerified: true, certainty: "explicit", reconfirmation: { romance: "friends_only", contact: "resume" } }] };
    const state = reduceRelationship({ scope, ledger: h.ledger, commits: h.commits, capabilities: { romance: true }, invalidatedRestriction: true });
    expect(state.interactionSafety).toBe("reconfirmation_required");
    expect(state.proactiveAllowed).toBe(false);
  });

  it.each(["explicit_friend_boundary", "contact_resume"] as const)("does not treat a new %s alone as complete scope reconfirmation", (kind) => {
    const h = harness();
    h.turn("s1", "e1", []);
    h.turn("s2", "e2", [kind]);
    h.commits[1] = { ...h.commits[1]!, expectedBoundaryRevision: 1 };
    const state = reduceRelationship({ scope, ledger: h.ledger, commits: h.commits, capabilities: { romance: true }, invalidatedRestriction: { afterSequence: 1 } });
    expect(state.interactionSafety).toBe("reconfirmation_required");
    expect(state.proactiveAllowed).toBe(false);
  });

  it("keeps known local boundaries and unresolved conflict after friendship reconfirmation", () => {
    const h = harness();
    h.turn("s1", "e1", []);
    h.commits[0] = { ...h.commits[0]!, candidates: [{ kind: "boundary_set", sourceMessageIds: ["u1"], semanticVerified: true, certainty: "explicit", boundary: { scope: "topic", target: "work" } }] };
    h.turn("s2", "e2", ["conflict_reported"]);
    h.turn("s3", "e3", []);
    h.commits[2] = { ...h.commits[2]!, expectedBoundaryRevision: 3, candidates: [{ kind: "explicit_relationship_reconfirmation", sourceMessageIds: ["u3"], semanticVerified: true, certainty: "explicit", reconfirmation: { romance: "friends_only", contact: "resume" } }] };
    const state = reduceRelationship({ scope, ledger: h.ledger, commits: h.commits, capabilities: { romance: true }, invalidatedRestriction: { afterSequence: 2 } });
    expect(state.reconfirmationSequence).toBeNull();
    expect(state.interactionSafety).toBe("unresolved_conflict");
    expect(state.boundaries).toEqual(expect.arrayContaining([expect.objectContaining({ scope: "topic", target: "work" }), expect.objectContaining({ scope: "romance" })]));
    expect(state.userRomanticIntent).toBe("friends_only");
  });

  it("allows voluntary friendship growth after user-initiated-only reconfirmation but respects a later stop", () => {
    const h = harness();
    h.turn("s1", "e1", []);
    h.turn("s2", "e2", []);
    h.commits[1] = { ...h.commits[1]!, expectedBoundaryRevision: 1, candidates: [{ kind: "explicit_relationship_reconfirmation", sourceMessageIds: ["u2"], semanticVerified: true, certainty: "explicit", reconfirmation: { romance: "friends_only", contact: "user_initiated_only" } }] };
    h.turn("s3", "e3", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    h.commits[2] = { ...h.commits[2]!, expectedBoundaryRevision: 2 };
    h.turn("s4", "e4", ["user_continuity_return"], ["u3"]);
    h.commits[3] = { ...h.commits[3]!, expectedBoundaryRevision: 2 };
    const replay = () => reduceRelationship({ scope, ledger: h.ledger, commits: h.commits, capabilities: { romance: true }, invalidatedRestriction: { afterSequence: 1 } });
    expect(replay().familiarity).toBe("familiar");
    expect(replay().proactiveAllowed).toBe(false);
    expect(replay().userRomanticIntent).toBe("friends_only");
    h.turn("s5", "e5", ["contact_stop"]);
    h.commits[4] = { ...h.commits[4]!, expectedBoundaryRevision: 2 };
    h.turn("s6", "e6", ["user_trust_or_value"]);
    h.commits[5] = { ...h.commits[5]!, expectedBoundaryRevision: 3 };
    h.turn("s6", "e7", ["shared_positive_exchange"]);
    h.commits[6] = { ...h.commits[6]!, expectedBoundaryRevision: 3 };
    h.turn("s7", "e8", ["mutual_conversation_welcome"]);
    h.commits[7] = { ...h.commits[7]!, expectedBoundaryRevision: 3 };
    expect(replay().familiarity).toBe("familiar");
    expect(replay().proactiveAllowed).toBe(false);
  });
});
