import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  verifyRequestUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyRequestUser: mocks.verifyRequestUser,
}));

vi.mock("@/src/modules/providers/tts/minimax-tts", () => ({
  MiniMaxTtsError: class MiniMaxTtsError extends Error {},
  createMiniMaxTextToSpeech: vi.fn(),
}));

import { POST } from "@/app/api/v1/conversations/tts/route";

describe("conversation TTS route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.verifyRequestUser.mockResolvedValue(null);
  });

  it("returns a versioned error envelope for invalid input", async () => {
    const response = await POST(new NextRequest("http://localhost/api/v1/conversations/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "" }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      apiVersion: "v1",
      error: { code: "VALIDATION_FAILED", retryable: false },
    });
  });

  it("does not fall back to a cookie user when an explicit bearer is invalid", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "cookie-user" });
    const response = await POST(new NextRequest("http://localhost/api/v1/conversations/tts", {
      method: "POST",
      headers: { authorization: "Bearer invalid", "content-type": "application/json" },
      body: JSON.stringify({ text: "hola" }),
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      apiVersion: "v1",
      error: { code: "AUTH_REQUIRED", retryable: false },
    });
  });
});
