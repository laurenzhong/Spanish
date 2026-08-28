import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { GET, POST } from "@/app/api/v1/character-network/lucia-contact/route";

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: vi.fn(),
  verifyRequestUser: vi.fn(),
}));

const mockedVerifyRequestUser = vi.mocked(verifyRequestUser);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

describe("Lucía contact route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
  });

  it("requires authentication before reading the request", async () => {
    mockedVerifyRequestUser.mockResolvedValue(null);
    mockedGetCurrentUser.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/v1/character-network/lucia-contact"));
    expect(response.status).toBe(401);
  });

  it("rejects an invalid decision without touching the database", async () => {
    mockedVerifyRequestUser.mockResolvedValue({ id: "user-a", email: null });
    const response = await POST(new NextRequest("http://localhost/api/v1/character-network/lucia-contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "maybe" }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INPUT_INVALID" } });
  });

  it("returns an honest unavailable error when persistence is not configured", async () => {
    mockedVerifyRequestUser.mockResolvedValue({ id: "user-a", email: null });
    const response = await GET(new NextRequest("http://localhost/api/v1/character-network/lucia-contact"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "CONTACT_UNAVAILABLE" } });
  });
});
