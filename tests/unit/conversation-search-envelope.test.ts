import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchMessages: vi.fn(),
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  verifyRequestUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyRequestUser: mocks.verifyRequestUser,
}));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/src/modules/conversation", async () => {
  const actual = await vi.importActual<typeof import("@/src/modules/conversation")>("@/src/modules/conversation");
  return {
    ...actual,
    createDrizzleConversationRepository: vi.fn(() => ({ searchMessages: mocks.searchMessages })),
  };
});

import { GET } from "@/app/api/v1/conversations/search/route";

describe("conversation search v1 envelope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.verifyRequestUser.mockResolvedValue(null);
  });

  it("adds apiVersion to successful search responses", async () => {
    mocks.searchMessages.mockResolvedValue([{
      id: "10000000-0000-4000-8000-000000000001",
      characterKey: "lucia",
      characterName: "Lucía Martín",
      role: "user",
      content: "Hablamos del café.",
      createdAt: new Date("2026-09-27T08:00:00.000Z"),
    }]);

    const response = await GET(new NextRequest("http://localhost/api/v1/conversations/search?q=café"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      apiVersion: "v1",
      data: {
        query: "café",
        results: [{ characterKey: "lucia", role: "user" }],
      },
    });
  });

  it("returns a non-retryable envelope for invalid search input", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/v1/conversations/search?q=${"x".repeat(121)}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      apiVersion: "v1",
      error: {
        code: "INPUT_INVALID",
        message: "The conversation search query is invalid.",
        retryable: false,
      },
    });
  });

  it("returns a retryable envelope when search persistence fails", async () => {
    mocks.searchMessages.mockRejectedValueOnce(new Error("db down"));
    const response = await GET(new NextRequest("http://localhost/api/v1/conversations/search?q=café"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      apiVersion: "v1",
      error: {
        code: "CONVERSATION_SEARCH_UNAVAILABLE",
        message: "Conversation search is temporarily unavailable.",
        retryable: true,
      },
    });
  });
});
