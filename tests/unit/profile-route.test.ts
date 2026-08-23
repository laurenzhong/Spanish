import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/profile/route";

describe("GET /api/v1/profile", () => {
  it("requires an authenticated user before touching profile storage", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/profile", {
        headers: { "x-request-id": "profile_12345678" },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      apiVersion: "v1",
      error: {
        code: "AUTH_REQUIRED",
        message: "A valid user session is required.",
        retryable: false,
        requestId: "profile_12345678",
      },
    });
  });
});
