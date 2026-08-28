import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { DELETE } from "@/app/api/v1/me/characters/lucia/data/route";

describe("/api/v1/me/characters/lucia/data", () => {
  const previousE2e = process.env.AUTH_E2E_ENABLED;

  afterEach(() => {
    if (previousE2e === undefined) delete process.env.AUTH_E2E_ENABLED;
    else process.env.AUTH_E2E_ENABLED = previousE2e;
  });

  it("requires authentication", async () => {
    const response = await DELETE(new NextRequest("http://localhost/api/v1/me/characters/lucia/data", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "RESET_LUCIA_DATA" }),
      headers: { "content-type": "application/json", "idempotency-key": "lucia_12345678" },
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      apiVersion: "v1",
      error: { code: "AUTH_REQUIRED" },
    });
  });

  it("requires the exact confirmation", async () => {
    process.env.AUTH_E2E_ENABLED = "1";
    const request = new NextRequest("http://localhost/api/v1/me/characters/lucia/data", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE_MY_DATA" }),
      headers: { "content-type": "application/json", "idempotency-key": "lucia_12345678" },
    });
    request.cookies.set("spanish-e2e-user", "00000000-0000-4000-0000-000000000099");

    const response = await DELETE(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
  });

  it("requires an idempotency key after confirmation", async () => {
    process.env.AUTH_E2E_ENABLED = "1";
    const request = new NextRequest("http://localhost/api/v1/me/characters/lucia/data", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "RESET_LUCIA_DATA" }),
      headers: { "content-type": "application/json" },
    });
    request.cookies.set("spanish-e2e-user", "00000000-0000-4000-0000-000000000099");

    const response = await DELETE(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
  });
});
