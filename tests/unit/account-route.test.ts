import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/me/route";

describe("GET /api/v1/me", () => {
  it("requires an authenticated user before touching account storage", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/me", { headers: { "x-request-id": "account_12345678" } }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ apiVersion: "v1", error: { code: "AUTH_REQUIRED", requestId: "account_12345678" } });
  });
});
