import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(), generate: vi.fn(), preview: vi.fn(),
  user: vi.fn(),
}));
vi.mock("@/src/modules/conversation", async (original) => ({
  ...await original<typeof import("@/src/modules/conversation")>(),
  resolveConversationCharacter: mocks.resolve,
  generateLuciaProactiveMessage: mocks.generate,
  previewLuciaProactiveMessage: mocks.preview,
  createDrizzleProactiveMessageRepository: vi.fn(() => ({})),
}));
vi.mock("@/src/modules/characters", async (original) => ({
  ...await original<typeof import("@/src/modules/characters")>(),
  createDrizzleCharacterRepository: vi.fn(() => ({})),
}));
vi.mock("@/src/modules/memory", () => ({ createDrizzleMemoryRepository: vi.fn(() => ({ listReadableMemories: vi.fn().mockResolvedValue([]) })) }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/src/shared/auth/request-user", () => ({ getRequestUser: mocks.user }));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: vi.fn(), verifyRequestUser: vi.fn() }));
vi.mock("@/src/modules/providers/conversation/server", () => ({ createMiniMaxConversationProvider: vi.fn(() => ({ generate: vi.fn() })), createOpenAIConversationProvider: vi.fn() }));

import { POST } from "@/app/api/v1/conversations/lucia/proactive/route";
import { getConversationCharacter } from "@/src/modules/conversation/domain/character-catalog";
import { createOpenAIConversationProvider } from "@/src/modules/providers/conversation/server";

describe("Lucía proactive route published context", () => {
  const character = { ...getConversationCharacter("lucia").snapshot, characterVersion: 3, tone: ["voz publicada"] };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://fake.invalid/testing");
    vi.stubEnv("MINIMAX_API_KEY", "fake-test-key");
    vi.stubEnv("CONVERSATION_PROVIDER", "minimax");
    mocks.user.mockResolvedValue({ id: "user-1" });
    mocks.resolve.mockResolvedValue({ catalog: { snapshot: character } });
    mocks.generate.mockResolvedValue({ status: "generated", candidate: { id: "candidate-1", messageId: "message-1" }, message: { id: "message-1" } });
    mocks.preview.mockResolvedValue({ status: "preview", text: "Una alegría pequeña para hoy." });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([false, true])("passes the published snapshot for preview=%s", async (preview) => {
    const response = await POST(new NextRequest("http://localhost/api/v1/conversations/lucia/proactive", {
      method: "POST", body: JSON.stringify({ sourceType: "daily_share", preview }),
    }));
    expect(response.status).toBe(preview ? 200 : 201);
    expect(preview ? mocks.preview : mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ character, userId: "user-1" }));
  });

  it("selects DeepSeek for proactive generation when configured", async () => {
    vi.stubEnv("CONVERSATION_PROVIDER", "deepseek");
    vi.stubEnv("OPENAI_API_KEY", "deepseek-test-key");
    const response = await POST(new NextRequest("http://localhost/api/v1/conversations/lucia/proactive", {
      method: "POST", body: JSON.stringify({ sourceType: "daily_share" }),
    }));
    expect(response.status).toBe(201);
    expect(vi.mocked(createOpenAIConversationProvider)).toHaveBeenCalledWith({ providerName: "deepseek" });
  });

  it("does not generate when the published runtime cannot be resolved", async () => {
    mocks.resolve.mockRejectedValue(new Error("unavailable"));
    const response = await POST(new NextRequest("http://localhost/api/v1/conversations/lucia/proactive", {
      method: "POST", body: JSON.stringify({ sourceType: "daily_share" }),
    }));
    expect(response.status).toBe(503);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});
