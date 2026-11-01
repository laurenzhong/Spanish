import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conversationCharacterVersion } from "@/src/modules/conversation/domain/character-catalog";

// The route serves the catalog's current revision; asking for a superseded one
// is refused, so these requests follow the catalog instead of a literal.
const luciaVersion = conversationCharacterVersion("lucia") ?? 1;

import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { POST } from "@/app/api/v1/conversations/[characterId]/stream/route";
import { GET } from "@/app/api/v1/conversations/[characterId]/route";

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: vi.fn(),
  verifyRequestUser: vi.fn(),
}));

vi.mock("@/src/modules/providers/conversation/server", () => ({
  createMiniMaxConversationProvider: vi.fn(),
  createOpenAIConversationProvider: vi.fn(() => ({
    generate: vi.fn(async () => ({
      text: "Hola.",
      provider: "deepseek",
      modelVersion: "deepseek-flash",
      providerRequestId: "deepseek-test",
      latencyMs: 1,
      estimatedCostMicros: null,
    })),
  })),
}));

const mockedVerifyRequestUser = vi.mocked(verifyRequestUser);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);
const { createOpenAIConversationProvider: mockedCreateOpenAIConversationProvider } = await import("@/src/modules/providers/conversation/server");

describe("conversation stream route authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to DeepSeek when its key is configured", async () => {
    vi.stubEnv("CONVERSATION_PROVIDER", "");
    vi.stubEnv("OPENAI_API_KEY", "deepseek-test-key");
    vi.stubEnv("OPENAI_CONVERSATION_MODEL", "deepseek-flash");
    mockedVerifyRequestUser.mockResolvedValue(null);
    mockedGetCurrentUser.mockResolvedValue({ id: "deepseek-user", email: null });
    const request = new NextRequest("http://localhost/api/v1/conversations/lucia/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterVersion: luciaVersion, text: "hola", clientMessageId: "deepseek-client", generationId: "deepseek-generation" }),
    });
    const response = await POST(request, { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(200);
    expect(mockedCreateOpenAIConversationProvider).toHaveBeenCalledWith({ providerName: "deepseek" });
    vi.unstubAllEnvs();
  });

  it("accepts the Web session cookie when no bearer token is present", async () => {
    mockedVerifyRequestUser.mockResolvedValue(null);
    mockedGetCurrentUser.mockResolvedValue({ id: "web-user", email: "web@example.test" });
    const request = new NextRequest("http://localhost/api/v1/conversations/lucia/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        characterVersion: luciaVersion,
        text: "hola",
        clientMessageId: "client-1",
        generationId: "generation-1",
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"type":"meta"');
    expect(body).toContain('"type":"done"');
    expect(mockedGetCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("refuses a superseded revision instead of opening a second conversation", async () => {
    mockedVerifyRequestUser.mockResolvedValue(null);
    mockedGetCurrentUser.mockResolvedValue({ id: "web-user", email: "web@example.test" });
    const request = new NextRequest("http://localhost/api/v1/conversations/lucia/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        characterVersion: luciaVersion - 1,
        text: "hola",
        clientMessageId: "client-superseded",
        generationId: "generation-superseded",
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "CHARACTER_UNAVAILABLE" } });
  });

  it("requires authentication before reading conversation history", async () => {
    mockedVerifyRequestUser.mockResolvedValue(null);
    mockedGetCurrentUser.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/v1/conversations/lucia");
    const response = await GET(request, { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      apiVersion: "v1",
      error: {
        code: "AUTH_REQUIRED",
        message: "A valid user session is required.",
        retryable: false,
      },
    });
  });

  it("returns a complete v1 envelope for invalid stream input", async () => {
    mockedVerifyRequestUser.mockResolvedValue({ id: "web-user", email: "web@example.test" });
    mockedGetCurrentUser.mockResolvedValue({ id: "web-user", email: "web@example.test" });
    const request = new NextRequest("http://localhost/api/v1/conversations/lucia/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "", clientMessageId: "client-1", generationId: "generation-1" }),
    });
    const response = await POST(request, { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      apiVersion: "v1",
      error: {
        code: "INPUT_INVALID",
        message: "This conversation request cannot be started.",
        retryable: false,
      },
    });
  });

  it("does not fall back to the Web cookie when a bearer token is invalid", async () => {
    mockedVerifyRequestUser.mockResolvedValue(null);
    mockedGetCurrentUser.mockResolvedValue({ id: "cookie-user", email: "cookie@example.test" });
    const request = new NextRequest("http://localhost/api/v1/conversations/lucia", {
      headers: { authorization: "Bearer invalid" },
    });

    const response = await GET(request, { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(401);
    expect(mockedGetCurrentUser).not.toHaveBeenCalled();
  });

  it("fails closed in production when persistence and a real provider are absent", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousFake = process.env.CONVERSATION_ALLOW_FAKE;
    try {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.DATABASE_URL;
      delete process.env.CONVERSATION_ALLOW_FAKE;
      mockedVerifyRequestUser.mockResolvedValue({ id: "production-user", email: null });
      mockedGetCurrentUser.mockResolvedValue({ id: "production-user", email: null });
      const request = new NextRequest("http://localhost/api/v1/conversations/lucia/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterVersion: luciaVersion, text: "hola", clientMessageId: "client-production", generationId: "generation-production" }),
      });
      const response = await POST(request, { params: Promise.resolve({ characterId: "lucia" }) });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        apiVersion: "v1",
        error: {
          code: "CONVERSATION_UNAVAILABLE",
          message: "Conversation runtime is unavailable.",
          retryable: true,
        },
      });
    } finally {
      vi.unstubAllEnvs();
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousFake === undefined) delete process.env.CONVERSATION_ALLOW_FAKE; else process.env.CONVERSATION_ALLOW_FAKE = previousFake;
    }
  });
});
