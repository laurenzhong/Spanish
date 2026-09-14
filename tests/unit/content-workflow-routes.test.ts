// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/internal/content-workflow/candidates/route";

describe("content workflow routes", () => {
  const previousAuth = process.env.AUTH_E2E_ENABLED;
  const previousOwners = process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
  const previousDatabase = process.env.DATABASE_URL;
  const ownerId = "00000000-0000-4000-8000-000000000721";

  afterEach(() => {
    if (previousAuth === undefined) delete process.env.AUTH_E2E_ENABLED; else process.env.AUTH_E2E_ENABLED = previousAuth;
    if (previousOwners === undefined) delete process.env.CONTENT_WORKFLOW_OWNER_USER_IDS; else process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = previousOwners;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase;
  });

  function request(userId?: string, headers: Record<string, string> = {}) {
    return new NextRequest("http://localhost/api/v1/internal/content-workflow/candidates", {
      headers: userId ? { ...headers, cookie: `spanish-e2e-user=${userId}` } : headers,
    });
  }

  it("rejects missing sessions, non-owners, missing allowlists, and forged roles", async () => {
    process.env.AUTH_E2E_ENABLED = "1";
    process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = ownerId;
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("00000000-0000-4000-8000-000000000722"))).status).toBe(403);
    expect((await GET(request("00000000-0000-4000-8000-000000000722", { "x-user-role": "owner" }))).status).toBe(403);
    delete process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
    expect((await GET(request(ownerId))).status).toBe(403);
  });

  it("passes an allowlisted owner to the database boundary without exposing data when unavailable", async () => {
    process.env.AUTH_E2E_ENABLED = "1";
    process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = ownerId;
    delete process.env.DATABASE_URL;
    const response = await GET(request(ownerId));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });
});
