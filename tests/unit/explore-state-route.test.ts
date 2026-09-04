import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), verifyRequestUser: vi.fn() }));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser, verifyRequestUser: mocks.verifyRequestUser }));

import { POST } from "@/app/api/v1/explore/state/route";

describe("explore state route", () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.DATABASE_URL; });

  it("requires authentication", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(new NextRequest("http://localhost/api/v1/explore/state", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
  });

  it("returns a retryable unavailable error without a database", async () => {
    mocks.verifyRequestUser.mockResolvedValue({ id: "user-1" });
    const response = await POST(new NextRequest("http://localhost/api/v1/explore/state", { method: "POST", body: JSON.stringify({ stableKey: "pack.cafe", version: 1, totalSteps: 5, completedSteps: 1, saved: true }) }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "EXPLORE_STATE_UNAVAILABLE", retryable: true } });
  });
});
