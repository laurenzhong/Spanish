import { describe, expect, it } from "vitest";
import { RelationshipUnitOfWorkError } from "@/src/modules/character-network/application/relationship-transaction";

describe("relationship transaction orchestration", () => {
  it("exposes fail-closed epoch, revision and ownership errors", () => {
    expect(new RelationshipUnitOfWorkError("RELATIONSHIP_EPOCH_CONFLICT").code).toBe("RELATIONSHIP_EPOCH_CONFLICT");
    expect(new RelationshipUnitOfWorkError("RELATIONSHIP_REVISION_CONFLICT").code).toBe("RELATIONSHIP_REVISION_CONFLICT");
    expect(new RelationshipUnitOfWorkError("RELATIONSHIP_HEAD_OWNERSHIP").name).toBe("RelationshipUnitOfWorkError");
  });
});
