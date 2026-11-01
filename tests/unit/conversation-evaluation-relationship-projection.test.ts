import { describe, expect, it } from "vitest";
import { admitEvaluationRelationshipTurn, createEvaluationRelationshipProjection } from "../../scripts/conversation-evaluation/relationship-projection";

function turn(index: number, session: number, user: string, assistant = "Te escucho con calma.") {
  const generationId = `relationship-${index}`;
  return { user: { id: `${generationId}-user`, role: "user" as const, sessionId: `session-${session}`, episodeId: `episode-${index}`, generationId, content: user }, assistant: { id: `${generationId}-assistant`, role: "assistant" as const, sessionId: `session-${session}`, episodeId: `episode-${index}`, generationId, content: assistant } };
}

describe("isolated relationship projection for conversation evaluation", () => {
  it("advances familiarity only from independent completed episodes", () => {
    let projection = createEvaluationRelationshipProjection({ ownerId: "evaluation-user" });
    expect(projection.state.familiarity).toBe("new_contact");

    projection = admitEvaluationRelationshipTurn(projection, turn(1, 1, "Quiero contarte mi familia; me gustaría compartir algo personal."));
    expect(projection.state.familiarity).toBe("new_contact");

    projection = admitEvaluationRelationshipTurn(projection, turn(2, 1, "Me alegra hablar contigo."));
    expect(projection.state.familiarity).toBe("getting_to_know_you");

    projection = admitEvaluationRelationshipTurn(projection, turn(3, 2, "He vuelto; aquí estoy."));
    expect(projection.state.familiarity).toBe("familiar");
    expect(projection.acceptedKinds).toEqual(expect.arrayContaining(["voluntary_personal_anchor", "mutual_conversation_welcome", "user_continuity_return"]));
  });

  it("keeps the friends-only boundary until a clear new romantic intention appears", () => {
    let projection = createEvaluationRelationshipProjection({ ownerId: "evaluation-user" });
    projection = admitEvaluationRelationshipTurn(projection, turn(1, 1, "Solo quiero amistad.", "Claro, respetaré que seamos amigos."));
    expect(projection.state.userRomanticIntent).toBe("friends_only");
    expect(projection.state.boundaries).toEqual(expect.arrayContaining([expect.objectContaining({ scope: "romance", target: "all" })]));

    projection = admitEvaluationRelationshipTurn(projection, turn(2, 2, "Me gustas.", "También me gustas."));
    expect(projection.state.userRomanticIntent).toBe("open");
    expect(projection.state.characterProposal).toBe("none");
    expect(projection.rejectedKinds).toEqual(expect.arrayContaining(["character_interest_signal"]));
  });
});
