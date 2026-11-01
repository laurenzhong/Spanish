import { describe, expect, it } from "vitest";
import { extractExplicitRelationshipBoundaries, extractRelationshipCandidates } from "@/src/modules/character-network/domain/relationship-candidate-extraction";

describe("explicit relationship boundary extraction", () => {
  it("recognizes only clear friendship and contact limits", () => {
    expect(extractExplicitRelationshipBoundaries({ text: "Prefiero que seamos solo amigos.", userMessageId: "m1" })).toEqual([
      expect.objectContaining({ kind: "explicit_friend_boundary", boundary: { scope: "romance", target: "all" }, sourceMessageIds: ["m1"] }),
    ]);
    expect(extractExplicitRelationshipBoundaries({ text: "No me contactes más.", userMessageId: "m2" })).toEqual([
      expect.objectContaining({ kind: "contact_stop", boundary: { scope: "contact", target: "all" } }),
    ]);
  });

  it("does not infer a boundary from warmth or ordinary conversation", () => {
    expect(extractExplicitRelationshipBoundaries({ text: "Me caes muy bien y me gusta hablar contigo.", userMessageId: "m3" })).toEqual([]);
    expect(extractExplicitRelationshipBoundaries({ text: "Hoy tuve un día difícil.", userMessageId: "m4" })).toEqual([]);
  });

  it("admits only explicit continuity, welcome, trust, and volunteered-anchor signals", () => {
    expect(extractRelationshipCandidates({ text: "Me alegra hablar contigo; he vuelto.", userMessageId: "m5" }).map((candidate) => candidate.kind))
      .toEqual(["mutual_conversation_welcome", "user_continuity_return"]);
    expect(extractRelationshipCandidates({ text: "Buenas, vuelvo después de unos días.", userMessageId: "m5b" }).map((candidate) => candidate.kind))
      .toEqual(["user_continuity_return"]);
    expect(extractRelationshipCandidates({ text: "Quiero contarte algo de mi familia.", userMessageId: "m6" })[0]).toMatchObject({
      kind: "voluntary_personal_anchor",
      certainty: "supported",
    });
    expect(extractRelationshipCandidates({ text: "Hoy estoy cansado y me caes bien.", userMessageId: "m7" })).toEqual([]);
    expect(extractRelationshipCandidates({ text: "Cada vez me hace más ilusión hablar contigo.", userMessageId: "m7b" }).map((candidate) => candidate.kind))
      .toEqual(["mutual_conversation_welcome"]);
  });

  it("treats a natural first-contact self introduction with a personal fact as an anchor", () => {
    expect(extractRelationshipCandidates({ text: "Hola, soy Álex. Me gusta cocinar.", messageId: "m-intro", role: "user" }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ kind: "voluntary_personal_anchor" })]));
  });

  it("keeps romantic declarations and character interest as separate explicit candidates", () => {
    expect(extractRelationshipCandidates({ text: "Me gustas y quiero estar contigo.", userMessageId: "m8" }).map((candidate) => candidate.kind))
      .toEqual(["user_romantic_declaration"]);
    expect(extractRelationshipCandidates({ text: "Me gustas, pero solo si tú también lo sientes.", messageId: "a1", role: "assistant" }).map((candidate) => candidate.kind))
      .toEqual(["character_interest_signal"]);
    expect(extractRelationshipCandidates({ text: "Quiero que seamos algo más.", messageId: "a2", role: "assistant" }).map((candidate) => candidate.kind))
      .toEqual(["character_relationship_proposal"]);
  });

  it("accepts natural relationship proposal and confirmation variants", () => {
    expect(extractRelationshipCandidates({ text: "Quiero que intentemos una relación, con calma.", messageId: "a-natural", role: "assistant" }).map((candidate) => candidate.kind))
      .toContain("character_relationship_proposal");
    expect(extractRelationshipCandidates({ text: "Sí, acepto intentarlo contigo.", messageId: "u-natural", role: "user" }).map((candidate) => candidate.kind))
      .toContain("explicit_romantic_confirmation");
  });
});
