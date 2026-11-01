import { describe, expect, it } from "vitest";
import { projectRelationshipStage } from "@/src/modules/character-network/repositories/relationship-context";

describe("persisted relationship stage projection", () => {
  it("does not stack same-episode signals into familiarity", () => {
    const events = [
      { kind: "voluntary_personal_anchor", episodeKey: "turn-1" },
      { kind: "mutual_conversation_welcome", episodeKey: "turn-1" },
      { kind: "user_continuity_return", episodeKey: "turn-1" },
    ] as const;
    expect(projectRelationshipStage(events)).toBe("new_contact");
  });

  it("requires independent episodes for the familiar projection", () => {
    const events = [
      { kind: "voluntary_personal_anchor", episodeKey: "turn-1" },
      { kind: "mutual_conversation_welcome", episodeKey: "turn-2" },
      { kind: "user_continuity_return", episodeKey: "turn-3" },
    ] as const;
    expect(projectRelationshipStage(events)).toBe("familiar");
  });
});
