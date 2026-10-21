import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDrizzleIntroductionRepository } from "@/src/modules/character-network";
import { resolveHistoryAccess } from "@/src/modules/conversation/application/resolve-history-access";

vi.mock("server-only", () => ({}));

vi.mock("@/src/modules/character-network", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/modules/character-network")>();
  return { ...actual, createDrizzleIntroductionRepository: vi.fn() };
});

const mockedCreateIntroductionRepository = vi.mocked(createDrizzleIntroductionRepository);

type RelationshipStatusReader = {
  getRelationshipStatus?: (
    userId: string,
    characterKey: string,
    characterVersion: number,
  ) => Promise<"active" | "declined" | "pending" | null>;
};

function repositoryReading(reader: RelationshipStatusReader | undefined) {
  mockedCreateIntroductionRepository.mockReturnValue(reader as never);
}

const database = {} as never;

/**
 * The non-Lucía gate resolves one merged statement into a nullable
 * relationship status. This suite pins the half of the fail-closed contract
 * that lives in the resolver: only an explicit "active" grant may open the
 * conversation, and an absent row (null) or an unreadable gate must stay
 * read-only. The SQL side of the same contract (published character, missing
 * relationship row) runs against PGlite in
 * tests/database/history-access-persistence.test.ts.
 */
describe("non-Lucía history access gate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("allows the conversation for an active relationship", async () => {
    repositoryReading({ getRelationshipStatus: vi.fn().mockResolvedValue("active") });
    await expect(resolveHistoryAccess(database, "user-a", "mateo")).resolves.toEqual({
      readOnly: false,
      canSend: true,
      contactStatus: "active",
    });
  });

  it("refuses to send when the relationship row is absent", async () => {
    repositoryReading({ getRelationshipStatus: vi.fn().mockResolvedValue(null) });
    await expect(resolveHistoryAccess(database, "user-a", "mateo")).resolves.toEqual({
      readOnly: true,
      canSend: false,
      contactStatus: "pending",
    });
  });

  it("refuses to send for a pending relationship", async () => {
    repositoryReading({ getRelationshipStatus: vi.fn().mockResolvedValue("pending") });
    await expect(resolveHistoryAccess(database, "user-a", "mateo")).resolves.toEqual({
      readOnly: true,
      canSend: false,
      contactStatus: "pending",
    });
  });

  it("refuses to send for a declined relationship", async () => {
    repositoryReading({ getRelationshipStatus: vi.fn().mockResolvedValue("declined") });
    await expect(resolveHistoryAccess(database, "user-a", "mateo")).resolves.toEqual({
      readOnly: true,
      canSend: false,
      contactStatus: "declined",
    });
  });

  it("refuses to send when the repository exposes no gate reader", async () => {
    repositoryReading({});
    await expect(resolveHistoryAccess(database, "user-a", "mateo")).resolves.toEqual({
      readOnly: true,
      canSend: false,
      contactStatus: "unavailable",
    });
  });

  it("refuses to send when the gate reader fails", async () => {
    repositoryReading({ getRelationshipStatus: vi.fn().mockRejectedValue(new Error("CHARACTER_UNAVAILABLE")) });
    await expect(resolveHistoryAccess(database, "user-a", "mateo")).resolves.toEqual({
      readOnly: true,
      canSend: false,
      contactStatus: "unavailable",
    });
  });
});
