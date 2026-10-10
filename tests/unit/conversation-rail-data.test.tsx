import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { listPreviews, getCurrentUser, getDatabase, railHost } = vi.hoisted(() => ({
  listPreviews: vi.fn(),
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(() => ({ database: "sentinel" })),
  railHost: vi.fn((props: { initialConversations?: readonly unknown[] }) => (
    <nav
      data-testid="rail-host"
      data-initial={props.initialConversations === undefined ? "none" : String(props.initialConversations.length)}
    />
  )),
}));

vi.mock("@/src/modules/conversation", () => ({ listConversationPreviews: listPreviews }));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase }));
vi.mock("@/src/modules/conversation/ui/conversation-rail-host", () => ({ ConversationRailHost: railHost }));

import ContactRailWithFirstPaint, { loadContactRailConversations } from "@/app/(product)/chat/_contact-rail-data";

const preview = {
  conversationId: "conversation-lucia",
  characterKey: "lucia",
  characterName: "Lucía Martín",
  avatarUrl: null,
  avatarClass: "avatar--lucia",
  roleLabel: "主要好友",
  lastMessageAt: null,
  lastMessage: null,
  isPinned: true,
  isMuted: false,
  sortRank: 0,
  unreadCount: 0,
};

describe("server-rendered contact list first paint", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("reads the contact list on the server and hands it to the rail", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test.invalid/db");
    getCurrentUser.mockResolvedValueOnce({ id: "user-1", email: null });
    listPreviews.mockResolvedValueOnce([preview]);

    const conversations = await loadContactRailConversations();

    expect(conversations).toEqual([preview]);
    expect(listPreviews).toHaveBeenCalledWith({ database: "sentinel" }, "user-1");
  });

  it("keeps the client request path when the database is not configured", async () => {
    const conversations = await loadContactRailConversations();

    expect(conversations).toBeUndefined();
    expect(listPreviews).not.toHaveBeenCalled();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("keeps the client request path when there is no signed-in user", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test.invalid/db");
    getCurrentUser.mockResolvedValueOnce(null);

    expect(await loadContactRailConversations()).toBeUndefined();
    expect(listPreviews).not.toHaveBeenCalled();
  });

  it("never fails the workspace when the list read fails", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test.invalid/db");
    getCurrentUser.mockResolvedValueOnce({ id: "user-1", email: null });
    listPreviews.mockRejectedValueOnce(new Error("database unavailable"));

    // The rail keeps its own retry state instead of breaking the pane.
    expect(await loadContactRailConversations()).toBeUndefined();
  });

  it("renders the rail with the server list as its first paint", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test.invalid/db");
    getCurrentUser.mockResolvedValueOnce({ id: "user-1", email: null });
    listPreviews.mockResolvedValueOnce([preview, { ...preview, conversationId: "conversation-mateo", characterKey: "mateo" }]);

    render(await ContactRailWithFirstPaint());

    expect(screen.getByTestId("rail-host")).toHaveAttribute("data-initial", "2");
    expect(railHost).toHaveBeenCalledWith({ initialConversations: expect.any(Array) }, undefined);
  });

  it("renders the rail without a server list when the read falls back", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test.invalid/db");
    getCurrentUser.mockResolvedValueOnce({ id: "user-1", email: null });
    listPreviews.mockRejectedValueOnce(new Error("database unavailable"));

    render(await ContactRailWithFirstPaint());

    expect(screen.getByTestId("rail-host")).toHaveAttribute("data-initial", "none");
  });
});
