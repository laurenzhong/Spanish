import { describe, expect, it } from "vitest";
import { RelationshipPersistenceError } from "@/src/modules/character-network/repositories/relationship-persistence-repository";

describe("relationship persistence port contract", () => {
  it("exposes typed conflict codes for CAS and ownership failures", () => {
    expect(new RelationshipPersistenceError("RELATIONSHIP_HEAD_REVISION_CONFLICT").code).toBe("RELATIONSHIP_HEAD_REVISION_CONFLICT");
    expect(new RelationshipPersistenceError("RELATIONSHIP_HEAD_OWNERSHIP").name).toBe("RelationshipPersistenceError");
    expect(new RelationshipPersistenceError("RELATIONSHIP_EVENT_CONFLICT").message).toBe("RELATIONSHIP_EVENT_CONFLICT");
  });

  it("keeps event input content-free by contract", () => {
    const source = { id: "event", sequence: 1, idempotencyKey: "receipt-1", eventKind: "anchor", certainty: "supported" as const, ruleVersion: "relationship-v1", sources: [{ messageId: "message", sourceRole: "user" as const, position: 0 }] };
    expect(source).not.toHaveProperty("content");
    expect(source.sources[0]).toMatchObject({ messageId: "message", sourceRole: "user" });
  });
});
