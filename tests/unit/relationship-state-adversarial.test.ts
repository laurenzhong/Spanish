// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  previewRelationshipResponse, reduceRelationship, validateRelationshipResponsePermit,
  type RelationshipCandidate, type RelationshipCommit, type RelationshipKind,
  type RelationshipLedger, type RelationshipPermit, type RelationshipSource,
} from "@/src/modules/character-network/domain/relationship-state";

const scope = { ownerId: "test-owner", identityId: "lucia", epoch: "fresh-evaluation" };
const candidate = (kind: RelationshipKind, sourceId: string, extra: Partial<RelationshipCandidate> = {}): RelationshipCandidate => ({
  kind, sourceMessageIds: [sourceId], semanticVerified: true, certainty: "explicit", ...extra,
});

/** Only server receipts and commits are arranged; relationship stages are never injected. */
function journey(romance = true) {
  const messages: RelationshipSource[] = [];
  const turns: RelationshipLedger["turns"][number][] = [];
  const commits: RelationshipCommit[] = [];
  const ledger = { messages, turns };
  const state = (invalidatedRestriction = false) => reduceRelationship({ scope, ledger, commits, capabilities: { romance }, invalidatedRestriction });
  function receipt(session: string, episode: string, status: "completed" | "pending" | "failed" = "completed") {
    const id = `turn-${turns.length + 1}`;
    const user = `${id}-user`, assistant = `${id}-assistant`, generationId = `${id}-generation`;
    for (const role of ["user", "assistant"] as const) messages.push({
      ...scope, id: role === "user" ? user : assistant, role,
      status: role === "user" ? "completed" : status,
      turnId: id, generationId, sessionId: session, episodeId: episode, characterVersion: 1,
    });
    turns.push({ ...scope, id, generationId, userMessageIds: [user], assistantMessageId: assistant, status, characterVersion: 1 });
    return { id, user, assistant, generationId };
  }
  function commit(r: ReturnType<typeof receipt>, candidates: RelationshipCandidate[], mode: "completed" | "guard" = "completed", permit?: RelationshipPermit) {
    commits.push({ ...scope, sequence: commits.length + 1, turnId: r.id, generationId: r.generationId,
      mode, expectedBoundaryRevision: state().boundaryRevision, candidates, ...(permit ? { permit } : {}),
    });
    return state();
  }
  function exchange(session: string, episode: string, kinds: RelationshipKind[], related: string[] = []) {
    const r = receipt(session, episode);
    commit(r, kinds.map((kind) => candidate(kind, kind.startsWith("character_") ? r.assistant : r.user, { relatedSourceMessageIds: related })));
    return r;
  }
  function preview(r: ReturnType<typeof receipt>, declaration?: RelationshipCandidate) {
    const current = state();
    return previewRelationshipResponse({ state: current, ledger, currentUserMessageId: r.user,
      expectedBoundaryRevision: current.boundaryRevision, capabilities: { romance }, declaration });
  }
  function establish() {
    const anchor = exchange("initial", "hobby", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    exchange("return", "hobby-followup", ["user_continuity_return"], [anchor.user]);
    exchange("return", "shared-story", ["shared_positive_exchange"]);
    expect(state().familiarity).toBe("familiar");
    return anchor;
  }
  return { messages, turns, ledger, commits, state, receipt, commit, exchange, preview, establish };
}

describe("independent adversarial relationship journeys", () => {
  it("reaches stable close friendship without romance, conflict or forced vulnerability", () => {
    const j = journey(false);
    expect(j.state().familiarity).toBe("new_contact");
    j.establish();
    j.exchange("third", "valued-perspective", ["user_trust_or_value"]);
    j.exchange("third", "enjoyed-conversation", ["shared_positive_exchange"]);
    j.exchange("fourth", "natural-return", ["mutual_conversation_welcome"]);
    expect(j.state()).toMatchObject({ familiarity: "close_friend", userRomanticIntent: "unspecified", characterProposal: "none" });
    expect(j.state().evidence.some((event) => event.kind === "conflict_reported")).toBe(false);
  });

  it("allows user-first confirmation only after real friendship and prior mutual support", () => {
    const j = journey();
    j.establish();
    const r = j.receipt("declaration", "user-declaration");
    const declaration = candidate("user_romantic_declaration", r.user);
    const permit = j.preview(r, declaration)!;
    expect(permit.allowAcceptance).toBe(true);
    expect(j.commit(r, [declaration, candidate("character_romantic_acceptance", r.assistant)], "completed", permit))
      .toMatchObject({ userRomanticIntent: "confirmed", characterProposal: "confirmed" });
  });

  it("allows character-first proposal and confirmation tied to the actually sent proposal", () => {
    const j = journey();
    j.establish();
    const interest = j.receipt("interest", "first-interest");
    j.commit(interest, [candidate("character_interest_signal", interest.assistant)], "completed", j.preview(interest)!);
    expect(j.state()).toMatchObject({ characterProposal: "interest_expressed", userRomanticIntent: "unspecified" });
    j.exchange("interest", "user-openness", ["explicit_romantic_openness"]);
    j.exchange("later", "mutual-return", ["shared_positive_exchange"]);
    const proposal = j.receipt("later", "actual-proposal");
    expect(j.preview(proposal)?.allowProposal).toBe(true);
    j.commit(proposal, [candidate("character_relationship_proposal", proposal.assistant)], "completed", j.preview(proposal)!);
    j.exchange("acceptance", "explicit-yes", ["explicit_romantic_confirmation"], [proposal.assistant]);
    expect(j.state()).toMatchObject({ userRomanticIntent: "confirmed", characterProposal: "confirmed" });
  });

  it("records a stranger's declaration without allowing a relationship jump", () => {
    const j = journey();
    const r = j.receipt("hello", "immediate-declaration");
    const declaration = candidate("user_romantic_declaration", r.user);
    const permit = j.preview(r, declaration)!;
    expect(permit.allowAcceptance).toBe(false);
    expect(j.commit(r, [declaration, candidate("character_romantic_acceptance", r.assistant)], "completed", permit))
      .toMatchObject({ familiarity: "new_contact", userRomanticIntent: "open", characterProposal: "none" });
  });

  it("does not repeat unanswered character interest just because a new session starts", () => {
    const j = journey();
    j.establish();
    const r = j.receipt("interest", "interest");
    j.commit(r, [candidate("character_interest_signal", r.assistant)], "completed", j.preview(r)!);
    const later = j.receipt("much-later", "ordinary-chat");
    expect(j.preview(later)).toMatchObject({ allowInterest: false, allowProposal: false, allowAcceptance: false });
  });

  it("keeps friends-only effective after failed assistant generation and later warmth", () => {
    const j = journey();
    j.establish();
    const refusal = j.receipt("refusal", "friend-boundary", "failed");
    j.commit(refusal, [candidate("explicit_friend_boundary", refusal.user), candidate("user_trust_or_value", refusal.user)], "guard");
    j.exchange("warm", "friendly-chat", ["mutual_conversation_welcome", "shared_positive_exchange"]);
    expect(j.state()).toMatchObject({ familiarity: "familiar", userRomanticIntent: "friends_only" });
    expect(j.state().evidence.some((event) => event.kind === "user_trust_or_value")).toBe(false);
    expect(j.preview(j.receipt("later", "still-friendly"))?.allowInterest).toBe(false);
  });

  it.each(["nickname", "topic"] as const)("keeps %s boundaries scoped while friendship reaches close_friend", (restriction) => {
    const j = journey(false);
    j.establish();
    const r = j.receipt("boundary", "scoped-refusal");
    j.commit(r, [candidate("boundary_set", r.user, { boundary: { scope: restriction, target: "private-detail" } })], "guard");
    j.exchange("third", "trust", ["user_trust_or_value"]);
    j.exchange("third", "pleasant", ["shared_positive_exchange"]);
    j.exchange("fourth", "return", ["mutual_conversation_welcome"]);
    expect(j.state().familiarity).toBe("close_friend");
    expect(j.state().boundaries).toEqual([expect.objectContaining({ scope: restriction, target: "private-detail" })]);
  });

  it.each(["ownerId", "identityId", "epoch", "generationId"] as const)("rejects growth backed by a source with mismatching %s", (field) => {
    const j = journey();
    const r = j.receipt("initial", "anchor");
    const index = j.messages.findIndex((message) => message.id === r.user);
    j.messages[index] = { ...j.messages[index]!, [field]: "foreign-or-obsolete" };
    j.commit(r, [candidate("voluntary_personal_anchor", r.user), candidate("mutual_conversation_welcome", r.user)]);
    expect(j.state()).toMatchObject({ familiarity: "new_contact", evidence: [] });
  });

  it("rejects stale epoch commits even when they point at current sources", () => {
    const j = journey();
    j.exchange("first", "anchor", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    j.commits[0] = { ...j.commits[0]!, epoch: "retired-epoch" };
    expect(j.state()).toMatchObject({ familiarity: "new_contact", evidence: [] });
  });

  it("never interprets character statements as user consent or trust", () => {
    const j = journey();
    j.establish();
    const r = j.receipt("character", "invented-consent");
    j.commit(r, [candidate("explicit_romantic_openness", r.assistant), candidate("user_trust_or_value", r.assistant), candidate("user_romantic_declaration", r.assistant)]);
    expect(j.state().userRomanticIntent).toBe("unspecified");
    expect(j.state().evidence.filter((event) => event.turnId === r.id)).toEqual([]);
  });

  it("cannot farm familiar through duplicated commits, duplicated episodes or recomputation", () => {
    const j = journey();
    const first = j.exchange("first", "same-event", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    const before = j.state();
    j.commits.push({ ...j.commits[0]!, sequence: 2 });
    j.exchange("second", "same-event", ["user_continuity_return"], [first.user]);
    j.exchange("third", "same-event", ["user_continuity_return"], [first.user]);
    expect(j.state().familiarity).toBe("getting_to_know_you");
    expect(j.state().evidence.filter((event) => event.kind === "voluntary_personal_anchor")).toHaveLength(1);
    expect(j.state()).toEqual(j.state());
    expect(before.familiarity).toBe("getting_to_know_you");
  });

  it("advances at most one stage from a densely tagged first exchange", () => {
    const j = journey();
    j.exchange("initial", "one-event", ["voluntary_personal_anchor", "mutual_conversation_welcome", "user_trust_or_value", "shared_positive_exchange", "user_continuity_return"]);
    expect(j.state().familiarity).toBe("getting_to_know_you");
  });

  it("requires reconfirmation after a restriction source is deleted", () => {
    const j = journey();
    j.establish();
    const r = j.receipt("refusal", "friend-only");
    j.commit(r, [candidate("explicit_friend_boundary", r.user)], "guard");
    const index = j.messages.findIndex((message) => message.id === r.user);
    j.messages[index] = { ...j.messages[index]!, status: "deleted" };
    const rebuilt = j.state(true);
    expect(rebuilt).toMatchObject({ interactionSafety: "reconfirmation_required", proactiveAllowed: false, userRomanticIntent: "unspecified" });
    expect(rebuilt.boundaries).toEqual([]);
    const fresh = j.receipt("later", "ordinary");
    expect(previewRelationshipResponse({ state: rebuilt, ledger: j.ledger, currentUserMessageId: fresh.user,
      expectedBoundaryRevision: rebuilt.boundaryRevision, capabilities: { romance: true } })?.allowAcceptance).toBe(false);
  });

  it("previews a pending declaration without committing it and revokes that permit on newer refusal", () => {
    const j = journey();
    j.establish();
    const before = j.state();
    const r = j.receipt("declaration", "pending-declaration", "pending");
    const permit = j.preview(r, candidate("user_romantic_declaration", r.user))!;
    expect(permit.allowAcceptance).toBe(true);
    expect(j.state()).toEqual(before);
    const refusal = j.receipt("declaration", "newer-refusal", "failed");
    j.commit(refusal, [candidate("explicit_friend_boundary", refusal.user)], "guard");
    expect(validateRelationshipResponsePermit({ state: j.state(), ledger: j.ledger, permit })).toBe(false);
  });

  it("does not treat a new user message as permission to resume proactive contact", () => {
    const j = journey();
    const r = j.receipt("stop", "stop-contact", "failed");
    j.commit(r, [candidate("contact_stop", r.user)], "guard");
    j.exchange("user-return", "one-question", ["mutual_conversation_welcome"]);
    expect(j.state().proactiveAllowed).toBe(false);
  });

  it("cannot reopen a refused relationship and confirm it in the same exchange", () => {
    const j = journey();
    j.establish();
    j.exchange("refusal", "friends", ["explicit_friend_boundary"]);
    const r = j.receipt("reopen", "new-declaration");
    const declaration = candidate("user_romantic_declaration", r.user);
    const permit = j.preview(r, declaration)!;
    expect(permit.allowAcceptance).toBe(false);
    j.commit(r, [declaration, candidate("character_romantic_acceptance", r.assistant)], "completed", permit);
    expect(j.state()).toMatchObject({ userRomanticIntent: "open", characterProposal: "none" });
  });

  it("rejects an otherwise valid complete growth commit with a stale boundary revision", () => {
    const j = journey();
    const first = j.exchange("first", "anchor", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    j.exchange("second", "refusal", ["explicit_friend_boundary"]);
    j.exchange("third", "return", ["user_continuity_return"], [first.user]);
    j.commits[2] = { ...j.commits[2]!, expectedBoundaryRevision: 0 };
    expect(j.state().familiarity).toBe("getting_to_know_you");
  });

  it("does not let historical openness erase the safety marker created by deleting a later refusal", () => {
    const j = journey();
    j.establish();
    j.exchange("old-openness", "old-open", ["explicit_romantic_openness"]);
    const refusal = j.exchange("later-refusal", "friends-only", ["explicit_friend_boundary"]);
    const index = j.messages.findIndex((message) => message.id === refusal.user);
    j.messages[index] = { ...j.messages[index]!, status: "deleted" };
    expect(j.state(true)).toMatchObject({ interactionSafety: "reconfirmation_required", proactiveAllowed: false });
  });

  it("rejects a guard from an obsolete generation even when its old user receipt survives", () => {
    const j = journey();
    const r = j.receipt("first", "old-generation", "pending");
    j.turns[0] = { ...j.turns[0]!, generationId: "replacement-generation" };
    j.commit(r, [candidate("explicit_friend_boundary", r.user)], "guard");
    expect(j.state()).toMatchObject({ userRomanticIntent: "unspecified", boundaryRevision: 0 });
  });

  it("requires an independent episode after reopening, not a rephrasing of that same event", () => {
    const j = journey();
    j.establish();
    j.exchange("refusal", "friends", ["explicit_friend_boundary"]);
    j.exchange("reopen", "same-reopen-event", ["user_romantic_declaration"]);
    j.exchange("later-session", "same-reopen-event", ["shared_positive_exchange"]);
    const r = j.receipt("response", "response-opportunity");
    expect(j.preview(r)?.allowAcceptance).toBe(false);
  });

  it("does not revive a withdrawn proposal after refusal and reopening", () => {
    const j = journey();
    j.establish();
    j.exchange("open", "openness", ["explicit_romantic_openness"]);
    j.exchange("later", "positive", ["shared_positive_exchange"]);
    const proposal = j.receipt("later", "original-proposal");
    j.commit(proposal, [candidate("character_relationship_proposal", proposal.assistant)], "completed", j.preview(proposal)!);
    expect(j.state().characterProposal).toBe("confirmation_pending");
    j.exchange("refusal", "friends", ["explicit_friend_boundary"]);
    j.exchange("reopen", "new-open", ["explicit_romantic_openness"]);
    j.exchange("reopen", "old-proposal-yes", ["explicit_romantic_confirmation"], [proposal.assistant]);
    expect(j.state()).toMatchObject({ userRomanticIntent: "open", characterProposal: "none" });
  });

  it("does not resolve conflicting equal-sequence commits using input array order", () => {
    const j = journey();
    j.exchange("first", "friend-boundary", ["explicit_friend_boundary"]);
    j.exchange("second", "openness", ["explicit_romantic_openness"]);
    j.commits[1] = { ...j.commits[1]!, sequence: 1, expectedBoundaryRevision: 0 };
    const forward = j.state();
    j.commits.reverse();
    expect(j.state()).toEqual(forward);
    expect(j.state().userRomanticIntent).not.toBe("open");
  });

  it.each(["pending", "failed"] as const)("does not gain trust or familiarity from a %s assistant turn", (status) => {
    const j = journey();
    const r = j.receipt("first", "personal-exchange", status);
    j.commit(r, [candidate("voluntary_personal_anchor", r.user), candidate("mutual_conversation_welcome", r.user)]);
    expect(j.state()).toMatchObject({ familiarity: "new_contact", evidence: [] });
  });

  it("rejects preview and permit after the server replaces their generation", () => {
    const j = journey();
    j.establish();
    const r = j.receipt("declaration", "pending-declaration", "pending");
    const declaration = candidate("user_romantic_declaration", r.user);
    const permit = j.preview(r, declaration)!;
    expect(permit.allowAcceptance).toBe(true);
    const index = j.turns.findIndex((turn) => turn.id === r.id);
    j.turns[index] = { ...j.turns[index]!, generationId: "replacement-generation" };
    expect(j.preview(r, declaration)).toBeNull();
    expect(validateRelationshipResponsePermit({ state: j.state(), ledger: j.ledger, permit })).toBe(false);
  });

  it("does not let uncertainty followed by openness erase an unresolved conflict", () => {
    const j = journey();
    j.establish();
    j.exchange("conflict", "unresolved", ["conflict_reported"]);
    const uncertain = j.receipt("ambiguous", "ambiguous-openness");
    j.commit(uncertain, [candidate("explicit_romantic_openness", uncertain.user, { certainty: "uncertain" })]);
    j.exchange("open", "romantic-open", ["explicit_romantic_openness"]);
    expect(j.state().interactionSafety).toBe("unresolved_conflict");
    expect(j.preview(j.receipt("later", "acceptance-opportunity"))?.allowAcceptance).toBe(false);
  });

  it("does not accept foreign related sources as continuity evidence", () => {
    const j = journey();
    const anchor = j.exchange("first", "anchor", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    j.messages.push({ ...j.messages[0]!, id: "foreign-anchor", ownerId: "another-owner" });
    j.exchange("return", "related-return", ["user_continuity_return"], [anchor.user, "foreign-anchor"]);
    expect(j.state().familiarity).toBe("getting_to_know_you");
  });

  it.each(["unknown", ""])("rejects the invalid commit mode '%s' at the runtime boundary", (mode) => {
    const j = journey();
    j.exchange("first", "invalid-control", ["explicit_romantic_openness"]);
    j.commits[0] = { ...j.commits[0]!, mode: mode as RelationshipCommit["mode"] };
    expect(j.state()).toMatchObject({ userRomanticIntent: "unspecified", evidence: [] });
  });

  it("does not store an unknown runtime evidence kind", () => {
    const j = journey();
    const r = j.receipt("first", "unknown-kind");
    j.commit(r, [candidate("invented_relationship_upgrade" as RelationshipKind, r.user)]);
    expect(j.state().evidence).toEqual([]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid authoritative sequence %s", (sequence) => {
    const j = journey();
    j.exchange("first", "invalid-sequence", ["explicit_romantic_openness"]);
    j.commits[0] = { ...j.commits[0]!, sequence };
    expect(j.state()).toMatchObject({ userRomanticIntent: "unspecified", evidence: [] });
  });
});
