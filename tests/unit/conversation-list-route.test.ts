import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listConversations: vi.fn(),
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  verifyRequestUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser, verifyRequestUser: mocks.verifyRequestUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/src/modules/conversation", async () => {
  const actual = await vi.importActual<typeof import("@/src/modules/conversation")>("@/src/modules/conversation");
  return { ...actual, createDrizzleConversationRepository: vi.fn(() => ({ listConversations: mocks.listConversations })) };
});

import { GET } from "@/app/api/v1/conversations/route";

describe("conversation list route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns persisted conversations ordered by the repository", async () => {
    mocks.listConversations.mockResolvedValue([{ conversationId: "c1", characterKey: "lucia", characterName: "Lucía Martín", avatarUrl: null, lastMessageAt: new Date("2026-08-27T10:00:00Z"), lastMessage: { role: "user", content: "Hola", createdAt: new Date("2026-08-27T10:00:00Z") }, unreadCount: 3 }]);
    const response = await GET(new NextRequest("http://localhost/api/v1/conversations"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ apiVersion: "v1", data: { conversations: [{ characterKey: "lucia", unreadCount: 3, lastMessage: { snippet: "Hola" } }] } });
  });

  it("returns the v1 error envelope when the session is missing", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const response = await GET(new NextRequest("http://localhost/api/v1/conversations"));
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

  it("returns a retryable v1 error when persistence is unavailable", async () => {
    mocks.listConversations.mockRejectedValueOnce(new Error("db down"));
    const response = await GET(new NextRequest("http://localhost/api/v1/conversations"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      apiVersion: "v1",
      error: {
        code: "CONVERSATION_LIST_UNAVAILABLE",
        message: "Conversation list is temporarily unavailable.",
        retryable: true,
      },
    });
  });
});
