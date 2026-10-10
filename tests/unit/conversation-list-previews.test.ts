import { describe, expect, it, vi } from "vitest";

const { listConversations } = vi.hoisted(() => ({ listConversations: vi.fn() }));

vi.mock("@/src/modules/conversation/repositories", () => ({
  createDrizzleConversationRepository: () => ({ listConversations }),
}));

import { listConversationPreviews } from "@/src/modules/conversation/application/list-conversation-previews";

const database = { database: "sentinel" } as never;

function record(overrides: Record<string, unknown>) {
  return {
    conversationId: "conversation-1",
    characterKey: "lucia",
    characterName: "Lucía Martín",
    avatarUrl: null,
    lastMessageAt: null,
    lastMessage: null,
    isPinned: false,
    isMuted: false,
    sortRank: null,
    unreadCount: 0,
    ...overrides,
  };
}

describe("server contact list read", () => {
  it("rechecks the capability manifest so draft characters never reach the client", async () => {
    listConversations.mockResolvedValueOnce([
      record({ characterKey: "lucia", characterName: "Lucía Martín" }),
      record({ conversationId: "conversation-2", characterKey: "mateo", characterName: "Mateo Ruiz" }),
    ]);

    const conversations = await listConversationPreviews(database, "user-1");

    expect(conversations.map((entry) => entry.characterKey)).toEqual(["lucia"]);
  });

  it("maps repository rows to the client preview DTO", async () => {
    listConversations.mockResolvedValueOnce([
      record({
        conversationId: "conversation-lucia",
        isPinned: true,
        unreadCount: 3,
        lastMessageAt: new Date("2026-10-10T08:20:00.000Z"),
        lastMessage: { role: "character", content: "¡Hasta luego!", createdAt: new Date("2026-10-10T08:20:00.000Z") },
      }),
    ]);

    const conversations = await listConversationPreviews(database, "user-1");

    expect(conversations).toEqual([{
      conversationId: "conversation-lucia",
      characterKey: "lucia",
      // Display name and avatar come from the persisted row, while the role
      // label is the catalog projection.
      characterName: "Lucía Martín",
      avatarUrl: null,
      avatarClass: "avatar--lucia",
      roleLabel: "主要好友",
      lastMessageAt: "2026-10-10T08:20:00.000Z",
      lastMessage: { role: "character", snippet: "¡Hasta luego!", createdAt: "2026-10-10T08:20:00.000Z" },
      isPinned: true,
      isMuted: false,
      sortRank: null,
      unreadCount: 3,
    }]);
  });

  it("returns an empty list instead of failing when there is no conversation", async () => {
    listConversations.mockResolvedValueOnce([]);

    expect(await listConversationPreviews(database, "user-1")).toEqual([]);
  });
});
