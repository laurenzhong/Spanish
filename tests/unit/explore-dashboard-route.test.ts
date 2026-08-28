import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  verifyRequestUser: vi.fn(),
}));

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyRequestUser: mocks.verifyRequestUser,
}));

import { GET } from "@/app/api/v1/explore/dashboard/route";

describe("explore dashboard route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a user session", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/v1/explore/dashboard"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED", retryable: false } });
  });

  it("returns a versioned dashboard for an authenticated user", async () => {
    mocks.verifyRequestUser.mockResolvedValue({ id: "user-1" });

    const response = await GET(new NextRequest("http://localhost/api/v1/explore/dashboard", { headers: { "x-request-id": "explore-test-1" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ apiVersion: "v1", data: { goals: expect.any(Array), packs: expect.any(Array), userState: "unavailable" } });
  });
});

