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
    mocks.listConversations.mockResolvedValue([{ conversationId: "c1", characterKey: "mateo", characterName: "Mateo Ruiz", avatarUrl: null, lastMessageAt: new Date("2026-08-27T10:00:00Z"), lastMessage: { role: "user", content: "Hola", createdAt: new Date("2026-08-27T10:00:00Z") } }]);
    const response = await GET(new NextRequest("http://localhost/api/v1/conversations"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { conversations: [{ characterKey: "mateo", lastMessage: { snippet: "Hola" } }] } });
  });
});
