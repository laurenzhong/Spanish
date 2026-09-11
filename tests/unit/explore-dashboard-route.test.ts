import fs from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  verifyRequestUser: vi.fn(),
}));

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyRequestUser: mocks.verifyRequestUser,
}));

import { GET } from "@/app/api/v1/explore/dashboard/route";

describe("explore dashboard route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a user session", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/v1/explore/dashboard"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED", retryable: false } });
  });

  it("returns a versioned dashboard for an authenticated user", async () => {
    mocks.verifyRequestUser.mockResolvedValue({ id: "user-1" });

    const response = await GET(new NextRequest("http://localhost/api/v1/explore/dashboard", { headers: { "x-request-id": "explore-test-1" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(payload).toMatchObject({ apiVersion: "v1", data: { goals: expect.any(Array), packs: expect.any(Array), userState: "unavailable", library: { scenarios: expect.any(Array), expressions: expect.any(Array), privateState: "unavailable" } } });

    const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), "contracts/schemas/v1/explore-dashboard-response.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true);
  });
});
