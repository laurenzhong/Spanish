import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  verifyRequestUser: vi.fn().mockResolvedValue(null),
  synthesize: vi.fn(),
}));

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyRequestUser: mocks.verifyRequestUser,
}));

vi.mock("@/src/modules/providers/tts/minimax-tts", () => ({
  MiniMaxTtsError: class MiniMaxTtsError extends Error {},
  createMiniMaxTextToSpeech: vi.fn(),
}));
vi.mock("@/src/modules/providers/tts/application/synthesize-read-aloud", () => ({ synthesizeReadAloud: mocks.synthesize }));

import { POST } from "@/app/api/v1/conversations/tts/route";
import { POST as sharedPOST } from "@/app/api/v1/tts/route";

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

  it("aliases the shared route and passes authenticated ownership into the application", async () => {
    expect(POST).toBe(sharedPOST);
    mocks.synthesize.mockResolvedValue({ audio: new Uint8Array([73, 68, 51]), metadata: { provider: "minimax", model: "speech-2.8-turbo", voiceId: "Spanish_SereneWoman" } });
    const response = await POST(new NextRequest("http://localhost/api/v1/tts", { method: "POST", body: JSON.stringify({ text: " Hola ", languageTag: "es-ES" }) }));
    expect(mocks.synthesize).toHaveBeenCalledWith("user-1", "Hola", expect.any(AbortSignal));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-tts-voice")).toBe("Spanish_SereneWoman");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([73, 68, 51]));
  });

  it.each([{ text: "x".repeat(1001) }, { text: "Hola", voiceId: "other" }, { text: "Hola", languageTag: "en-US" }])("rejects client policy overrides and oversized chunks", async (body) => {
    const response = await POST(new NextRequest("http://localhost/api/v1/tts", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(400); expect(mocks.synthesize).not.toHaveBeenCalled();
  });
});
