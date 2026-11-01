import { describe, expect, it } from "vitest";
import {
  admitRelationshipCommit, replayAcceptedRelationship, previewRelationshipResponse,
  type AcceptedRelationshipReceipt, type RelationshipCandidate, type RelationshipLedger,
} from "@/src/modules/character-network/domain/relationship-state";

const scope = { ownerId: "replay-owner", identityId: "lucia", epoch: "fresh" };
function fixture() {
  const ledger: { messages: RelationshipLedger["messages"][number][]; turns: RelationshipLedger["turns"][number][] } = { messages: [], turns: [] };
  const acceptedReceipts: AcceptedRelationshipReceipt[] = [];
  let boundaryRevision = 0;
  const input = () => ({ scope, ledger, acceptedReceipts, boundaryRevision, capabilities: { romance: true } });
  function turn(n: number, kinds: RelationshipCandidate["kind"][], related: string[] = []) {
    const id = `t${n}`, user = `u${n}`, assistant = `a${n}`, generationId = `g${n}`;
    for (const role of ["user", "assistant"] as const) ledger.messages.push({ ...scope, id: role === "user" ? user : assistant,
      role, status: "completed", sessionId: `s${n}`, episodeId: `e${n}`, authoritativeTurnIds: [id] });
    ledger.turns.push({ ...scope, id, generationId, userMessageIds: [user], assistantMessageId: assistant, status: "completed", characterVersion: 4 });
    const result = admitRelationshipCommit({ ...input(), commit: { ...scope, sequence: n, turnId: id, generationId,
      mode: "completed", expectedBoundaryRevision: boundaryRevision,
      candidates: kinds.map(kind => ({ kind, sourceMessageIds: [user], relatedSourceMessageIds: related, certainty: "explicit", semanticVerified: true })),
    } });
    expect(result).not.toBeNull();
    acceptedReceipts.push(result!.receipt); boundaryRevision = result!.receipt.boundaryRevisionAfter;
    return { user, assistant };
  }
  return { ledger, acceptedReceipts, input, turn };
}

describe("relationship admission versus accepted replay", () => {
  it("keeps independent evidence after deleting repair without replaying historical CAS", () => {
    const h = fixture();
    const conflict = h.turn(1, ["conflict_reported"]);
    const repair = h.turn(2, ["repair_acknowledged"], [conflict.user]);
    const anchor = h.turn(3, ["voluntary_personal_anchor", "mutual_conversation_welcome"]);
    h.ledger.messages = h.ledger.messages.map(message => message.id === repair.user ? { ...message, status: "deleted" } : message);
    const state = replayAcceptedRelationship({ ...h.input(), boundaryRevision: 3 });
    expect(state.boundaryRevision).toBe(3);
    expect(state.interactionSafety).toBe("unresolved_conflict");
    expect(state.evidence.some(event => event.sourceMessageIds.includes(anchor.user))).toBe(true);
  });

  it.each(["assistant", "other-user"] as const)("retains accepted completed-turn restrictions after deleting %s", deleted => {
    const h = fixture();
    const first = h.turn(1, ["explicit_friend_boundary"]);
    if (deleted === "assistant") h.ledger.messages = h.ledger.messages.filter(message => message.id !== first.assistant);
    else {
      // The second member was official at admission; only its deletion makes the complete turn unavailable.
      const member = { ...h.ledger.messages[0]!, id: "batch-user", status: "deleted" as const };
      h.ledger.messages.push(member);
      h.ledger.turns[0] = { ...h.ledger.turns[0]!, userMessageIds: [first.user, member.id] };
      h.acceptedReceipts[0] = { ...h.acceptedReceipts[0]!, turn: h.ledger.turns[0]! };
    }
    h.ledger.messages = h.ledger.messages.map(message => message.id === first.user ? { ...message, authoritativeTurnIds: [] } : message);
    const state = replayAcceptedRelationship(h.input());
    expect(state.userRomanticIntent).toBe("friends_only");
    expect(state.boundaries).toEqual([expect.objectContaining({ scope: "romance", sourceMessageIds: [first.user] })]);
    expect(state.evidence).toHaveLength(1);
  });

  it("retains admitted uncertainty without persisting rejected candidates", () => {
    const h = fixture();
    h.turn(1, ["voluntary_personal_anchor"]);
    const receipt = h.acceptedReceipts[0]!;
    const declaration = { ...receipt.commit.candidates[0]!, kind: "user_romantic_declaration" as const, certainty: "uncertain" as const };
    const admitted = admitRelationshipCommit({ ...h.input(), acceptedReceipts: [], boundaryRevision: 0,
      commit: { ...receipt.commit, candidates: [declaration] } });
    expect(admitted?.receipt.commit.candidates).toEqual([declaration]);
    expect(replayAcceptedRelationship({ ...h.input(), acceptedReceipts: [admitted!.receipt], boundaryRevision: admitted!.receipt.boundaryRevisionAfter }).interactionSafety).toBe("uncertain");
  });

  it("requires generation selection for canonical preview and refuses unknown membership", () => {
    const h = fixture();
    const first = h.turn(1, ["voluntary_personal_anchor"]);
    const state = replayAcceptedRelationship(h.input());
    expect(previewRelationshipResponse({ state, ledger: h.ledger, currentUserMessageId: first.user, expectedBoundaryRevision: 0, capabilities: { romance: true } })).toBeNull();
    expect(previewRelationshipResponse({ state, ledger: h.ledger, currentUserMessageId: first.user, generationId: "g1", expectedBoundaryRevision: 0, capabilities: { romance: true } })?.turnId).toBe("t1");
    expect(previewRelationshipResponse({ state, ledger: h.ledger, currentUserMessageId: first.user, generationId: "other", expectedBoundaryRevision: 0, capabilities: { romance: true } })).toBeNull();
  });
});
