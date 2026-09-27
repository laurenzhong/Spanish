import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    deleteMessage: vi.fn(),
    withdrawMessage: vi.fn(),
  },
  memoryRepository: { deleteBySourceMessage: vi.fn() },
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  verifyRequestUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/src/modules/characters", () => ({
  createDrizzleCharacterRepository: vi.fn(() => ({})),
}));
vi.mock("@/src/modules/memory", () => ({
  createDrizzleMemoryRepository: vi.fn(() => mocks.memoryRepository),
  deleteMemoriesForSourceMessage: vi.fn(),
}));
vi.mock("@/src/modules/conversation", () => ({
  CharacterRuntimeError: class CharacterRuntimeError extends Error {
    code = "CHARACTER_UNAVAILABLE" as const;
  },
  createDrizzleConversationRepository: vi.fn(() => mocks.repository),
  findConversationCharacter: vi.fn(() => true),
  isConversationStaticFallbackAllowed: vi.fn(() => true),
  resolveConversationCharacter: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyRequestUser: mocks.verifyRequestUser,
}));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));

import {
  DELETE as MESSAGE_DELETE,
  PATCH as MESSAGE_PATCH,
} from "@/app/api/v1/conversations/[characterId]/messages/[messageId]/route";

const messageId = "10000000-0000-4000-8000-000000000001";
const routeContext = { params: Promise.resolve({ characterId: "lucia", messageId }) };

describe("conversation message mutation v1 envelope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/db");
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.verifyRequestUser.mockResolvedValue(null);
    mocks.repository.deleteMessage.mockResolvedValue(true);
    mocks.repository.withdrawMessage.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("wraps delete success in the v1 envelope", async () => {
    const response = await MESSAGE_DELETE(
      new NextRequest(`http://localhost/api/v1/conversations/lucia/messages/${messageId}`),
      routeContext,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apiVersion: "v1", data: { deleted: true } });
  });

  it("wraps withdraw success in the v1 envelope", async () => {
    const response = await MESSAGE_PATCH(
      new NextRequest(`http://localhost/api/v1/conversations/lucia/messages/${messageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "withdraw" }),
      }),
      routeContext,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apiVersion: "v1", data: { withdrawn: true } });
  });

  it("returns a complete non-retryable envelope for invalid mutation input", async () => {
    const response = await MESSAGE_PATCH(
      new NextRequest(`http://localhost/api/v1/conversations/lucia/messages/${messageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      }),
      routeContext,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      apiVersion: "v1",
      error: {
        code: "INPUT_INVALID",
        message: "The message request is invalid.",
        retryable: false,
      },
    });
  });
});
