import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { GET, POST } from "@/app/api/v1/character-network/introductions/route";
import { GET as GET_PERMISSIONS } from "@/app/api/v1/character-network/permissions/route";

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: vi.fn(),
  verifyRequestUser: vi.fn(),
}));

const mockedVerifyRequestUser = vi.mocked(verifyRequestUser);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

describe("character network introduction route authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
  });

  it("requires authentication before listing offers", async () => {
    mockedVerifyRequestUser.mockResolvedValue(null);
    mockedGetCurrentUser.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/v1/character-network/introductions"));
    expect(response.status).toBe(401);
  });

  it("rejects malformed proposals before touching the database", async () => {
    mockedVerifyRequestUser.mockResolvedValue({ id: "user-a", email: null });
    const response = await POST(new NextRequest("http://localhost/api/v1/character-network/introductions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetCharacterKey: "unknown" }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INPUT_INVALID" } });
  });

  it("requires authentication before listing shared permissions", async () => {
    mockedVerifyRequestUser.mockResolvedValue(null);
    mockedGetCurrentUser.mockResolvedValue(null);
    const response = await GET_PERMISSIONS(new NextRequest("http://localhost/api/v1/character-network/permissions"));
    expect(response.status).toBe(401);
  });
});
