import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { createDrizzleIntroductionRepository, createDrizzleLuciaContactRepository } from "@/src/modules/character-network";
import { POST } from "@/app/api/v1/conversations/[characterId]/stream/route";

vi.mock("server-only", () => ({}));

vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: vi.fn(), verifyRequestUser: vi.fn() }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/src/modules/character-network", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/modules/character-network")>();
  return { ...actual, createDrizzleIntroductionRepository: vi.fn(), createDrizzleLuciaContactRepository: vi.fn() };
});

const mockedVerifyRequestUser = vi.mocked(verifyRequestUser);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);
const mockedCreateContactRepository = vi.mocked(createDrizzleLuciaContactRepository);
const mockedCreateIntroductionRepository = vi.mocked(createDrizzleIntroductionRepository);

describe("Lucía conversation gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test";
    mockedVerifyRequestUser.mockResolvedValue({ id: "user-a", email: null });
    mockedGetCurrentUser.mockResolvedValue(null);
    mockedCreateContactRepository.mockReturnValue({
      get: vi.fn().mockResolvedValue({ status: "pending" }),
    } as never);
    mockedCreateIntroductionRepository.mockReturnValue({
      getRelationshipStatus: vi.fn().mockResolvedValue(null),
    } as never);
  });

  it("rejects a pending Lucía request before creating a message", async () => {
    const response = await POST(new NextRequest("http://localhost/api/v1/conversations/lucia/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterVersion: 1, text: "hola", clientMessageId: "c1", generationId: "g1" }),
    }), { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "CONTACT_REQUIRED" } });
  });

  it("rejects a draft Mateo character before checking relationship state", async () => {
    const response = await POST(new NextRequest("http://localhost/api/v1/conversations/mateo/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterVersion: 1, text: "hola", clientMessageId: "c2", generationId: "g2" }),
    }), { params: Promise.resolve({ characterId: "mateo" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "CHARACTER_UNAVAILABLE" } });
  });
});
