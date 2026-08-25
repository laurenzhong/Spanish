import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { DELETE, GET } from "@/app/api/v1/profile/memories/route";

describe("/api/v1/profile/memories", () => {
  it("requires authentication before listing private memories", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/profile/memories", {
      headers: { "x-request-id": "memory_12345678" },
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      apiVersion: "v1",
      error: { code: "AUTH_REQUIRED", requestId: "memory_12345678" },
    });
  });

  it("requires authentication before attempting deletion", async () => {
    const response = await DELETE(new NextRequest("http://localhost/api/v1/profile/memories?memoryId=not-a-uuid", {
      headers: { "x-request-id": "memory_12345678" },
    }));

    expect(response.status).toBe(401);
  });
});
