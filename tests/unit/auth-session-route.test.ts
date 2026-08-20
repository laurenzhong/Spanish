import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/auth/session/route";

describe("GET /api/v1/auth/session", () => {
  it("returns a stable authorization error without a session", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/auth/session", {
        headers: { "x-request-id": "request_12345678" },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      apiVersion: "v1",
      error: {
        code: "AUTH_REQUIRED",
        message: "A valid user session is required.",
        retryable: false,
        requestId: "request_12345678",
      },
    });
  });
});
