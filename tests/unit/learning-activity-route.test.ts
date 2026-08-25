import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/practice/sessions/[sessionId]/activity/route";

describe("POST /api/v1/practice/sessions/:sessionId/activity", () => {
  it("requires an authenticated user before touching activity storage", async () => {
    const response = await POST(
      new NextRequest(
        "http://localhost/api/v1/practice/sessions/00000000-0000-4000-8000-000000000001/activity",
        {
          method: "POST",
          headers: { "x-request-id": "activity_12345678" },
          body: JSON.stringify({
            clientInstanceId: "web-1",
            eventType: "active",
            sequence: 1,
          }),
        },
      ),
      {
        params: Promise.resolve({
          sessionId: "00000000-0000-4000-8000-000000000001",
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      apiVersion: "v1",
      error: {
        code: "AUTH_REQUIRED",
        message: "A valid user session is required.",
        retryable: false,
        requestId: "activity_12345678",
      },
    });
  });
});
