import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { DELETE, GET } from "@/app/api/v1/me/data/route";

describe("/api/v1/me/data", () => {
  const previousE2e = process.env.AUTH_E2E_ENABLED;

  afterEach(() => {
    if (previousE2e === undefined) delete process.env.AUTH_E2E_ENABLED;
    else process.env.AUTH_E2E_ENABLED = previousE2e;
  });

  it("requires authentication before reading the deletion body", async () => {
    const response = await DELETE(
      new NextRequest("http://localhost/api/v1/me/data", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: "DELETE_MY_DATA" }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": "account_12345678",
          "x-request-id": "account_12345678",
        },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      apiVersion: "v1",
      error: { code: "AUTH_REQUIRED", requestId: "account_12345678" },
    });
  });

  it("requires authentication before returning the account data summary", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/me/data", {
        headers: { "x-request-id": "account_12345678" },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("requires the exact explicit confirmation", async () => {
    process.env.AUTH_E2E_ENABLED = "1";
    const request = new NextRequest("http://localhost/api/v1/me/data", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE_ACCOUNT" }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "account_12345678",
      },
    });
    request.cookies.set("spanish-e2e-user", "00000000-0000-4000-0000-000000000099");

    const response = await DELETE(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
  });
});
