import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "cookie-user" }),
  verifyRequestUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/src/shared/auth/server", () => authMocks);

import { GET } from "@/app/api/v1/me/route";

describe("GET /api/v1/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getCurrentUser.mockResolvedValue(null);
    authMocks.verifyRequestUser.mockResolvedValue(null);
  });

  it("requires an authenticated user before touching account storage", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/me", { headers: { "x-request-id": "account_12345678" } }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ apiVersion: "v1", error: { code: "AUTH_REQUIRED", requestId: "account_12345678" } });
  });

  it("does not use a cookie identity when an explicit bearer is invalid", async () => {
    const request = new NextRequest("http://localhost/api/v1/me", {
      headers: { authorization: "Bearer invalid", "x-request-id": "account_invalid_bearer" },
    });

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(authMocks.verifyRequestUser).toHaveBeenCalledWith(request);
    expect(authMocks.getCurrentUser).not.toHaveBeenCalled();
  });
});
