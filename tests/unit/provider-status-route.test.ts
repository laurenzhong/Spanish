// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), verifyRequestUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyRequestUser: mocks.verifyRequestUser,
}));

import { handleGetProviderStatus } from "@/app/api/v1/providers/status/route";

describe("provider status route", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.verifyRequestUser.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000501" });
  });

  it("requires authentication", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    const response = await handleGetProviderStatus(new NextRequest("http://localhost/api/v1/providers/status"), {
      registrations: [],
      preferences: { list: vi.fn(), set: vi.fn(), clear: vi.fn() },
      health: { listObservationSummaries: vi.fn() },
    });
    expect(response.status).toBe(401);
  });

  it("returns private, credential-free capability status", async () => {
    const response = await handleGetProviderStatus(new NextRequest("http://localhost/api/v1/providers/status"), {
      registrations: [
        { key: "minimax", label: "MiniMax", configured: true, capabilities: ["scenario-generation"] },
        { key: "openai", label: "OpenAI", configured: false, capabilities: ["scenario-generation", "transcription"] },
      ],
      preferences: { list: vi.fn(async () => []), set: vi.fn(), clear: vi.fn() },
      health: { listObservationSummaries: vi.fn(async () => []) },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload).toMatchObject({ apiVersion: "v1", data: { capabilities: expect.any(Array) } });
    expect(JSON.stringify(payload)).not.toMatch(/api[_-]?key|secret|prompt/iu);
  });
});
