import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { DELETE, GET } from "@/app/api/v1/profile/media/route";

describe("/api/v1/profile/media", () => {
  it("requires authentication before listing saved voice data", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/profile/media", {
      headers: { "x-request-id": "media_12345678" },
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      apiVersion: "v1",
      error: { code: "AUTH_REQUIRED", requestId: "media_12345678" },
    });
  });

  it("requires authentication before validating deletion input", async () => {
    const response = await DELETE(new NextRequest("http://localhost/api/v1/profile/media?kind=unknown&id=not-a-uuid", {
      headers: { "x-request-id": "media_12345678" },
    }));

    expect(response.status).toBe(401);
  });
});
