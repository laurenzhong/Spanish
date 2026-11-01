import { describe, expect, it } from "vitest";
import {
  admitRelationshipCommit, replayAcceptedRelationship,
  type AcceptedRelationshipReceipt, type RelationshipCandidate, type RelationshipCommit,
  type RelationshipKind, type RelationshipLedger, type RelationshipSource,
} from "@/src/modules/character-network/domain/relationship-state";

const scope = { ownerId: "receipt-owner", identityId: "lucia", epoch: "receipt-epoch" };
const evidence = (kind: RelationshipKind, id: string, related: string[] = []): RelationshipCandidate => ({
  kind, sourceMessageIds: [id], relatedSourceMessageIds: related, certainty: "explicit", semanticVerified: true,
});

/** Canonical message IDs remain unique even when official turns reuse them. */
function history() {
  const messages: RelationshipSource[] = [];
  const turns: RelationshipLedger["turns"][number][] = [];
  const acceptedReceipts: AcceptedRelationshipReceipt[] = [];
  let revision = 0;
  let sequence = 0;
  let turnCount = 0;
  let invalidatedRestriction: true | { afterSequence: number } | undefined;
  const input = () => ({ scope, ledger: { messages, turns }, acceptedReceipts,
    capabilities: { romance: true }, boundaryRevision: revision, invalidatedRestriction });
  const state = () => replayAcceptedRelationship(input());
  function turn(sessionId: string, episodeId: string, status: "completed" | "pending" | "failed" = "completed", reuseUser?: string) {
    const id = `turn-${++turnCount}`, user = reuseUser ?? `${id}-user`, assistant = `${id}-assistant`, generationId = `${id}-generation`;
    if (reuseUser) {
      const index = messages.findIndex((message) => message.id === reuseUser);
      if (index < 0) throw new Error("Fixture cannot reuse a missing canonical user source");
      messages[index] = { ...messages[index]!, authoritativeTurnIds: [...messages[index]!.authoritativeTurnIds!, id] };
    } else messages.push({ ...scope, id: user, role: "user", status: "completed", sessionId, episodeId, authoritativeTurnIds: [id] });
    messages.push({ ...scope, id: assistant, role: "assistant", status, sessionId, episodeId, authoritativeTurnIds: [id] });
    turns.push({ ...scope, id, generationId, userMessageIds: [user], assistantMessageId: assistant, status, characterVersion: 1 });
    return { id, user, assistant, generationId };
  }
  function commit(r: ReturnType<typeof turn>, candidates: RelationshipCandidate[], mode: "guard" | "completed" = "completed") {
    const next: RelationshipCommit = { ...scope, sequence: ++sequence, expectedBoundaryRevision: revision,
      turnId: r.id, generationId: r.generationId, mode, candidates };
    const result = admitRelationshipCommit({ ...input(), commit: next });
    if (result) {
      acceptedReceipts.push(result.receipt);
      revision = result.receipt.boundaryRevisionAfter;
    }
    return result;
  }
  function exchange(session: string, episode: string, kinds: RelationshipKind[], related: string[] = []) {
    const r = turn(session, episode);
    const result = commit(r, kinds.map((kind) => evidence(kind, r.user, related)));
    expect(result, `Fixture exchange ${episode} must be admissible`).not.toBeNull();
    return r;
  }
  function establish() {
    const first = exchange("first-session", "personal-anchor", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    exchange("second-session", "anchor-return", ["user_continuity_return"], [first.user]);
    expect(state().familiarity).toBe("familiar");
  }
  function removeSource(id: string, restriction = false) {
    const index = messages.findIndex((message) => message.id === id);
    messages[index] = { ...messages[index]!, status: "deleted" };
    revision++;
    if (restriction) invalidatedRestriction = { afterSequence: sequence };
  }
  return { messages, turns, acceptedReceipts, input, state, turn, commit, exchange, establish, removeSource,
    setInvalidatedRestriction: (marker: true | { afterSequence: number }) => { invalidatedRestriction = marker === true ? true : { ...marker }; } };
}

describe("accepted relationship receipt adversarial persistence contract", () => {
  it("preserves unrelated later accepted evidence when deleting an earlier repair", () => {
    const h = history();
    h.establish();
    const conflict = h.exchange("conflict-session", "specific-conflict", ["conflict_reported"]);
    const repair = h.exchange("repair-session", "accepted-repair", ["repair_acknowledged"], [conflict.user]);
    const later = h.exchange("later-session", "valued-conversation", ["user_trust_or_value"]);
    expect(h.state().interactionSafety).toBe("comfortable");
    h.removeSource(repair.user);
    const rebuilt = h.state();
    expect(rebuilt.interactionSafety).toBe("unresolved_conflict");
    expect(rebuilt.evidence.some((event) => event.kind === "repair_acknowledged")).toBe(false);
    expect(rebuilt.evidence).toContainEqual(expect.objectContaining({ kind: "user_trust_or_value", sourceMessageIds: [later.user] }));
    expect(rebuilt.boundaryRevision).toBe(h.input().boundaryRevision);
  });

  it("installs restriction deletion after historical intent so old openness cannot erase it", () => {
    const h = history();
    h.establish();
    h.exchange("open-session", "old-openness", ["explicit_romantic_openness"]);
    const refusal = h.exchange("refusal-session", "friends-only", ["explicit_friend_boundary"]);
    h.removeSource(refusal.user, true);
    expect(h.state()).toMatchObject({ interactionSafety: "reconfirmation_required", proactiveAllowed: false, boundaries: [] });
    const revision = h.state().boundaryRevision;
    expect(h.state().boundaryRevision).toBe(revision);
  });

  it("never persists rejected candidates that could become eligible after another source is deleted", () => {
    const h = history();
    const r = h.turn("contradictory-session", "contradictory-intent");
    const otherUser = `${r.id}-second-user`;
    h.messages.push({ ...scope, id: otherUser, role: "user", status: "completed", sessionId: "contradictory-session", episodeId: "contradictory-intent", authoritativeTurnIds: [r.id] });
    h.turns[0] = { ...h.turns[0]!, userMessageIds: [r.user, otherUser] };
    const accepted = h.commit(r, [evidence("explicit_friend_boundary", r.user), evidence("explicit_romantic_openness", otherUser)]);
    expect(accepted).not.toBeNull();
    expect(accepted!.receipt.commit.candidates.map((candidate) => candidate.kind)).toEqual(["explicit_friend_boundary"]);
    h.removeSource(r.user, true);
    const replay = h.state();
    expect(replay.userRomanticIntent).toBe("unspecified");
    expect(replay.evidence.some((event) => event.kind === "explicit_romantic_openness")).toBe(false);
    expect(replay.interactionSafety).toBe("reconfirmation_required");
  });

  it("does not count a canonical user message twice when two completed official turns reference it", () => {
    const h = history();
    const first = h.exchange("first-session", "one-event", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    const second = h.turn("later-session", "new-assistant-event", "completed", first.user);
    h.commit(second, [evidence("voluntary_personal_anchor", first.user), evidence("mutual_conversation_welcome", first.user), evidence("user_continuity_return", first.user, [first.user])]);
    expect(h.state().familiarity).toBe("getting_to_know_you");
    expect(h.state().evidence.filter((event) => event.kind === "voluntary_personal_anchor")).toHaveLength(1);
    expect(h.state().evidence.filter((event) => event.kind === "mutual_conversation_welcome")).toHaveLength(1);
    expect(h.messages.filter((message) => message.id === first.user)).toHaveLength(1);
  });

  it.each(["cancelled", "deleted"] as const)("keeps an accepted user guard when its assistant is later %s", (mutation) => {
    const h = history();
    const r = h.turn("refusal-session", "explicit-refusal", "pending");
    expect(h.commit(r, [evidence("explicit_friend_boundary", r.user)], "guard")).not.toBeNull();
    const assistantIndex = h.messages.findIndex((message) => message.id === r.assistant);
    if (mutation === "deleted") {
      h.messages.splice(assistantIndex, 1);
      h.turns.splice(0, 1);
    } else {
      h.messages[assistantIndex] = { ...h.messages[assistantIndex]!, status: "failed" };
      h.turns[0] = { ...h.turns[0]!, status: "failed" };
    }
    expect(h.state()).toMatchObject({ userRomanticIntent: "friends_only", boundaryRevision: 1 });
  });

  it("does not admit a new guard from an already cancelled generation", () => {
    const h = history();
    const r = h.turn("late-session", "late-refusal", "failed");
    expect(h.commit(r, [evidence("explicit_friend_boundary", r.user)], "guard")).toBeNull();
    expect(h.state()).toMatchObject({ userRomanticIntent: "unspecified", evidence: [] });
  });

  it("does not admit a new guard after its official generation is replaced", () => {
    const h = history();
    const r = h.turn("late-session", "late-refusal", "pending");
    h.turns[0] = { ...h.turns[0]!, generationId: "replacement-generation" };
    expect(h.commit(r, [evidence("explicit_friend_boundary", r.user)], "guard")).toBeNull();
    expect(h.state().evidence).toEqual([]);
  });

  it.each(["ownerId", "identityId", "epoch"] as const)("rejects a persisted receipt with a foreign %s", (field) => {
    const h = history();
    h.exchange("first-session", "user-refusal", ["explicit_friend_boundary"]);
    const receipt = h.acceptedReceipts[0]!;
    h.acceptedReceipts[0] = { ...receipt, commit: { ...receipt.commit, [field]: "foreign-scope" } };
    const replay = h.state();
    expect(replay.evidence).toEqual([]);
    expect(replay.boundaries).toEqual([]);
    expect(replay.userRomanticIntent).toBe("unspecified");
  });

  it("rejects a receipt whose snapshotted turn does not contain the claimed user source", () => {
    const h = history();
    h.exchange("first-session", "user-refusal", ["explicit_friend_boundary"]);
    const receipt = h.acceptedReceipts[0]!;
    h.acceptedReceipts[0] = { ...receipt, turn: { ...receipt.turn, userMessageIds: ["unrelated-user"] } };
    expect(h.state().evidence).toEqual([]);
    expect(h.state().boundaries).toEqual([]);
  });

  it("rejects a receipt whose saved turn belongs to a different owner", () => {
    const h = history();
    h.exchange("first-session", "user-refusal", ["explicit_friend_boundary"]);
    const receipt = h.acceptedReceipts[0]!;
    h.acceptedReceipts[0] = { ...receipt, turn: { ...receipt.turn, ownerId: "another-owner" } };
    expect(h.state().evidence).toEqual([]);
    expect(h.state().boundaries).toEqual([]);
  });

  it("does not regrow accepted evidence from a withdrawn canonical source", () => {
    const h = history();
    const r = h.exchange("first-session", "personal-event", ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    const index = h.messages.findIndex((message) => message.id === r.user);
    h.messages[index] = { ...h.messages[index]!, status: "withdrawn" };
    expect(h.state()).toMatchObject({ familiarity: "new_contact", evidence: [] });
  });

  it("does not lose later independent evidence when deleting an unrelated early boundary", () => {
    const h = history();
    h.establish();
    const restriction = h.turn("boundary-session", "nickname-boundary");
    h.commit(restriction, [{ ...evidence("boundary_set", restriction.user), boundary: { scope: "nickname", target: "unwanted-name" } }], "guard");
    const later = h.exchange("later-session", "independent-trust", ["user_trust_or_value"]);
    h.removeSource(restriction.user, true);
    expect(h.state().evidence).toContainEqual(expect.objectContaining({ kind: "user_trust_or_value", sourceMessageIds: [later.user] }));
    expect(h.state()).toMatchObject({ interactionSafety: "reconfirmation_required", boundaries: [] });
  });

  it("still checks current source ownership when replaying a previously accepted receipt", () => {
    const h = history();
    const r = h.exchange("first-session", "user-refusal", ["explicit_friend_boundary"]);
    const index = h.messages.findIndex((message) => message.id === r.user);
    h.messages[index] = { ...h.messages[index]!, ownerId: "foreign-owner" };
    expect(h.state().evidence).toEqual([]);
    expect(h.state().boundaries).toEqual([]);
  });

  it("does not accept an event through a corrupted saved turn with duplicate canonical members", () => {
    const h = history();
    const r = h.exchange("first-session", "user-refusal", ["explicit_friend_boundary"]);
    const receipt = h.acceptedReceipts[0]!;
    h.acceptedReceipts[0] = { ...receipt, turn: { ...receipt.turn, userMessageIds: [r.user, r.user] } };
    expect(h.state().evidence).toEqual([]);
    expect(h.state().boundaries).toEqual([]);
  });

  it("rejects a new commit with an old control revision while preserving its accepted history", () => {
    const h = history();
    h.exchange("first-session", "user-refusal", ["explicit_friend_boundary"]);
    const r = h.turn("later-session", "reopen-at-old-revision");
    const before = h.state();
    const result = admitRelationshipCommit({ ...h.input(), commit: {
      ...scope, sequence: 2, mode: "completed", turnId: r.id, generationId: r.generationId,
      expectedBoundaryRevision: 0, candidates: [evidence("explicit_romantic_openness", r.user)],
    } });
    expect(result).toBeNull();
    expect(h.state()).toEqual(before);
  });

  it("replays identically after an explicit deletion barrier is cleared by reconfirmation", () => {
    const h = history();
    h.establish();
    const refusal = h.exchange("refusal-session", "friends-only", ["explicit_friend_boundary"]);
    h.removeSource(refusal.user, true);
    const barrierState = h.state();
    expect(barrierState.interactionSafety).toBe("reconfirmation_required");
    const reconfirm = h.turn("reconfirm-session", "explicit-reconfirmation");
    const accepted = h.commit(reconfirm, [{
      ...evidence("explicit_relationship_reconfirmation", reconfirm.user),
      reconfirmation: { romance: "friends_only", contact: "user_initiated_only" },
    }]);
    expect(accepted).not.toBeNull();
    const persisted = JSON.parse(JSON.stringify(h.acceptedReceipts)) as AcceptedRelationshipReceipt[];
    const replayed = replayAcceptedRelationship({ ...h.input(), acceptedReceipts: persisted });
    expect(replayed).toEqual(h.state());
    expect(replayed.interactionSafety).toBe("comfortable");
  });

  it("fails closed when a deleted restriction has only a boolean invalidation marker", () => {
    const h = history();
    h.establish();
    const refusal = h.exchange("refusal-session", "friends-only", ["explicit_friend_boundary"]);
    h.removeSource(refusal.user);
    h.setInvalidatedRestriction(true);
    const next = h.turn("later-session", "ordinary-reply");
    expect(h.commit(next, [evidence("mutual_conversation_welcome", next.user)])).toBeNull();
    expect(h.state().interactionSafety).toBe("reconfirmation_required");
  });

  it("does not admit a commit when replay discovers a lost restriction but no afterSequence was persisted", () => {
    const h = history();
    h.establish();
    const refusal = h.exchange("refusal-session", "friends-only", ["explicit_friend_boundary"]);
    h.removeSource(refusal.user);
    const next = h.turn("later-session", "ordinary-reply");
    expect(h.commit(next, [evidence("mutual_conversation_welcome", next.user)])).toBeNull();
    expect(replayAcceptedRelationship(h.input()).interactionSafety).toBe("reconfirmation_required");
  });
});
