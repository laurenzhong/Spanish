import { describe, expect, it } from "vitest";
import { toPersistedRelationshipExportDto, toRelationshipExportDto } from "@/src/modules/character-network/application/relationship-privacy";
import type { RelationshipState } from "@/src/modules/character-network/domain/relationship-state";

const state: RelationshipState = { ownerId: "owner", identityId: "identity", epoch: "epoch", ruleVersion: "relationship-v1", familiarity: "familiar", userRomanticIntent: "friends_only", characterProposal: "none", interactionSafety: "comfortable", boundaryRevision: 3, boundaries: [{ scope: "romance", target: "all", sourceMessageIds: ["private"] }], evidence: [{ kind: "voluntary_personal_anchor", sourceMessageIds: ["m1"], relatedSourceMessageIds: [], sessionId: "s", episodeId: "e", sequence: 1, turnId: "t" }], familiaritySequence: 1, openSequence: null, openSessionId: null, reopenedSequence: null, lastProposalSequence: null, proactiveAllowed: true, reconfirmationSequence: null };
describe("relationship privacy export", () => {
  it("exports only public metadata and strips payload/source author details", () => {
    const dto = toRelationshipExportDto({ state, characterKey: "lucia", sourceStatus: { m1: "live" } });
    expect(dto).toMatchObject({ schemaVersion: 1, characterKey: "lucia", truncated: false });
    expect(JSON.stringify(dto)).not.toContain("owner");
    expect(JSON.stringify(dto)).not.toContain("identity");
    expect(JSON.stringify(dto)).not.toContain("private");
    expect(dto.evidence[0]).not.toHaveProperty("relatedSourceMessageIds");
  });
  it("truncates and excludes deleted source IDs", () => {
    const dto = toRelationshipExportDto({ state, characterKey: "lucia", limit: 0, sourceStatus: { m1: "deleted" } });
    expect(dto.evidence).toEqual([]);
    expect(dto.truncated).toBe(true);
  });
  it("projects persisted events conservatively without treating event count as intimacy", () => {
    const dto = toPersistedRelationshipExportDto({
      characterKey: "lucia", ruleVersion: "relationship-v1", boundaryRevision: 2,
      boundaries: [{ scope: "romance", target: "all", status: "active" }],
      events: [{ kind: "voluntary_personal_anchor", certainty: "supported", sequence: 1, turnId: "t1", episodeId: null, sessionId: null, sourceMessageIds: ["m1"] }],
    });
    expect(dto).toMatchObject({ characterKey: "lucia", familiarity: "new_contact", userRomanticIntent: "unspecified", characterProposal: "none" });
    expect(dto.evidence[0]).toMatchObject({ sequence: 1, sessionId: "persisted", episodeId: "persisted", sourceMessageIds: ["m1"] });
  });
});
