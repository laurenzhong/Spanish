import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateConversationPreference: vi.fn(),
  reorderConversationPreferences: vi.fn(),
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  verifyRequestUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser, verifyRequestUser: mocks.verifyRequestUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/src/modules/conversation", async () => {
  const actual = await vi.importActual<typeof import("@/src/modules/conversation")>("@/src/modules/conversation");
  return { ...actual, createDrizzleConversationRepository: vi.fn(() => ({ updateConversationPreference: mocks.updateConversationPreference, reorderConversationPreferences: mocks.reorderConversationPreferences })) };
});

import { PATCH } from "@/app/api/v1/conversations/preferences/route";

describe("conversation preferences route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates and persists an owned preference patch", async () => {
    mocks.updateConversationPreference.mockResolvedValue({ characterKey: "lucia", isPinned: false, isMuted: true });
    const response = await PATCH(new NextRequest("http://localhost/api/v1/conversations/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterKey: "lucia", isPinned: false, isMuted: true }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.updateConversationPreference).toHaveBeenCalledWith("user-1", "lucia", { isPinned: false, isMuted: true });
    expect(await response.json()).toEqual({ data: { preference: { characterKey: "lucia", isPinned: false, isMuted: true } } });
  });

  it("accepts an idempotent ordered list", async () => {
    const response = await PATCH(new NextRequest("http://localhost/api/v1/conversations/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderedCharacterKeys: ["lucia", "mateo"] }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.reorderConversationPreferences).toHaveBeenCalledWith("user-1", ["lucia", "mateo"]);
  });

  it("rejects an empty patch", async () => {
    const response = await PATCH(new NextRequest("http://localhost/api/v1/conversations/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterKey: "lucia" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.updateConversationPreference).not.toHaveBeenCalled();
  });
});
