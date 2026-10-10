import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listConversationPreviews: vi.fn(),
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  verifyRequestUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser, verifyRequestUser: mocks.verifyRequestUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
// The route is a transport: the list read and its capability recheck live in
// the conversation application layer (covered by
// conversation-list-previews.test.ts) and in the chat layout's first paint.
vi.mock("@/src/modules/conversation", () => ({ listConversationPreviews: mocks.listConversationPreviews }));

import { GET } from "@/app/api/v1/conversations/route";

const preview = {
  conversationId: "c1",
  characterKey: "lucia",
  characterName: "Lucía Martín",
  avatarUrl: null,
  avatarClass: "avatar--lucia",
  roleLabel: "主要好友",
  lastMessageAt: "2026-08-27T10:00:00.000Z",
  lastMessage: { role: "user", snippet: "Hola", createdAt: "2026-08-27T10:00:00.000Z" },
  isPinned: false,
  isMuted: false,
  sortRank: null,
  unreadCount: 3,
};

describe("conversation list route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the persisted conversation previews", async () => {
    mocks.listConversationPreviews.mockResolvedValueOnce([preview]);
    const response = await GET(new NextRequest("http://localhost/api/v1/conversations"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      apiVersion: "v1",
      data: { conversations: [{ characterKey: "lucia", unreadCount: 3, lastMessage: { snippet: "Hola" } }] },
    });
    expect(mocks.listConversationPreviews).toHaveBeenCalledWith({}, "user-1");
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
    mocks.listConversationPreviews.mockRejectedValueOnce(new Error("db down"));
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
