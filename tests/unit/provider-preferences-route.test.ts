// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), verifyRequestUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyRequestUser: mocks.verifyRequestUser,
}));

import {
  handleGetProviderPreferences,
  handlePatchProviderPreference,
} from "@/app/api/v1/me/provider-preferences/route";

const userId = "00000000-0000-4000-8000-000000000502";

describe("provider preferences route", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.verifyRequestUser.mockResolvedValue({ id: userId });
  });

  it("lists only the authenticated user's preferences", async () => {
    const repository = {
      list: vi.fn(async (requestedUserId: string) => requestedUserId === userId
        ? [{ capability: "scenario-roleplay" as const, providerKey: "minimax" }]
        : []),
      set: vi.fn(),
      clear: vi.fn(),
    };
    const response = await handleGetProviderPreferences(
      new NextRequest("http://localhost/api/v1/me/provider-preferences"),
      { repository },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { preferences: [{ capability: "scenario-roleplay", providerKey: "minimax" }] },
    });
    expect(repository.list).toHaveBeenCalledWith(userId);
  });

  it("rejects unsupported or unconfigured choices before writing", async () => {
    const repository = { list: vi.fn(), set: vi.fn(), clear: vi.fn() };
    const response = await handlePatchProviderPreference(new NextRequest(
      "http://localhost/api/v1/me/provider-preferences",
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ capability: "scenario-roleplay", providerKey: "openai" }) },
    ), {
      repository,
      registrations: [{ key: "openai", label: "OpenAI", configured: false, capabilities: ["scenario-roleplay"] }],
    });
    expect(response.status).toBe(400);
    expect(repository.set).not.toHaveBeenCalled();
  });

  it("persists a configured selection and clears it with null", async () => {
    const repository = {
      list: vi.fn(),
      set: vi.fn(async (_userId: string, capability: "scenario-roleplay", providerKey: string) => ({ capability, providerKey })),
      clear: vi.fn(async () => undefined),
    };
    const dependencies = {
      repository,
      registrations: [{ key: "minimax", label: "MiniMax", configured: true, capabilities: ["scenario-roleplay"] as const }],
    };
    const selected = await handlePatchProviderPreference(new NextRequest(
      "http://localhost/api/v1/me/provider-preferences",
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ capability: "scenario-roleplay", providerKey: "minimax" }) },
    ), dependencies);
    expect(selected.status).toBe(200);
    const automatic = await handlePatchProviderPreference(new NextRequest(
      "http://localhost/api/v1/me/provider-preferences",
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ capability: "scenario-roleplay", providerKey: null }) },
    ), dependencies);
    expect(automatic.status).toBe(200);
    expect(repository.set).toHaveBeenCalledWith(userId, "scenario-roleplay", "minimax");
    expect(repository.clear).toHaveBeenCalledWith(userId, "scenario-roleplay");
  });
});
