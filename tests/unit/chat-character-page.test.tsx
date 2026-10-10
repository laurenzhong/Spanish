import { describe, expect, it, vi } from "vitest";

const { chatThread, resolveCharacter, getCurrentUser, listHistory, resolveAccess } = vi.hoisted(() => ({
  chatThread: vi.fn((props: { characterKey: string; initialMessages?: unknown }) => (
    <div data-testid="chat-thread" data-character={props.characterKey} data-hydrated={props.initialMessages ? "true" : "false"} />
  )),
  resolveCharacter: vi.fn(),
  getCurrentUser: vi.fn(),
  listHistory: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("@/src/modules/conversation/ui/chat-thread", () => ({ ChatThread: chatThread }));
vi.mock("@/src/modules/conversation/ui/conversation-contact-rail", () => ({
  ConversationContactRail: (props: { activeCharacterKey: string }) => <nav data-testid="contact-rail" data-active={props.activeCharacterKey} />,
}));
vi.mock("@/src/modules/conversation", () => ({
  CharacterRuntimeError: class CharacterRuntimeError extends Error {
    code = "CHARACTER_UNAVAILABLE";
  },
  findConversationCharacter: (key: string) => ({
    key,
    displayName: key === "mateo" ? "Mateo Ruiz" : "Lucía Martín",
    roleLabel: "好友",
    version: 1,
    avatarClass: "avatar--lucia",
  }),
  isConversationCharacterDiscoverable: (key: string) => key === "lucia",
  isConversationStaticFallbackAllowed: () => true,
  resolveConversationCharacter: resolveCharacter,
  createDrizzleConversationRepository: () => ({}),
  listConversationHistory: listHistory,
  resolveHistoryAccess: resolveAccess,
}));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/src/modules/characters", () => ({ createDrizzleCharacterRepository: vi.fn(() => ({})) }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

import CharacterChatPage from "@/app/(product)/chat/[characterId]/page";

describe("dynamic character chat page", () => {
  it("shows a coming-soon state for a draft character without a composer", async () => {
    const view = await CharacterChatPage({
      params: Promise.resolve({ characterId: "mateo" }),
      searchParams: Promise.resolve({}),
    });

    expect(view).toBeTruthy();
    const serialized = JSON.stringify(view);
    expect(serialized).toContain("角色尚未开放");
    expect(chatThread).not.toHaveBeenCalled();
  });

  it("does not trust a published-looking static catalog when the persisted character is draft", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test.invalid/db");
    resolveCharacter.mockRejectedValueOnce({ code: "CHARACTER_UNAVAILABLE" });
    try {
      const view = await CharacterChatPage({
        params: Promise.resolve({ characterId: "lucia" }),
        searchParams: Promise.resolve({}),
      });
      expect(JSON.stringify(view)).toContain("角色尚未开放");
      expect(chatThread).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("shows an unavailable state when the persisted runtime cannot be read", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test.invalid/db");
    resolveCharacter.mockRejectedValueOnce({ code: "CHARACTER_RUNTIME_UNAVAILABLE" });
    try {
      const view = await CharacterChatPage({
        params: Promise.resolve({ characterId: "lucia" }),
        searchParams: Promise.resolve({}),
      });
      expect(JSON.stringify(view)).toContain("对话暂时不可用");
      expect(chatThread).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("renders the conversation on the server so the first paint carries real messages", async () => {
    // The thread used to fetch history after hydration: a whole extra round
    // trip before any message appeared, and a "cannot open this conversation"
    // notice whenever that read was slow. The page now ships the view itself.
    vi.stubEnv("DATABASE_URL", "postgres://test.invalid/db");
    resolveCharacter.mockResolvedValueOnce({ catalog: { displayName: "Lucía Martín" } });
    getCurrentUser.mockResolvedValueOnce({ id: "user-1", email: null });
    listHistory.mockResolvedValueOnce([{ id: "server-1", role: "character", text: "Hola", complete: true }]);
    resolveAccess.mockResolvedValueOnce({ readOnly: false, canSend: true, contactStatus: "active" });
    try {
      const view = await CharacterChatPage({
        params: Promise.resolve({ characterId: "lucia" }),
        searchParams: Promise.resolve({}),
      });

      const serialized = JSON.stringify(view);

      // The thread element already carries the server view, so the first paint
      // renders real messages instead of a skeleton.
      expect(serialized).toContain('"initialMessages":[{"id":"server-1"');
      expect(serialized).toContain('"initialAccess":{"readOnly":false,"canSend":true,"contactStatus":"active"}');
      expect(listHistory).toHaveBeenCalledWith(expect.anything(), "user-1", "lucia");
      expect(resolveAccess).toHaveBeenCalledWith(expect.anything(), "user-1", "lucia");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to the client history request when the server read fails", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test.invalid/db");
    resolveCharacter.mockResolvedValueOnce({ catalog: { displayName: "Lucía Martín" } });
    getCurrentUser.mockResolvedValueOnce({ id: "user-1", email: null });
    listHistory.mockRejectedValueOnce(new Error("database unavailable"));
    resolveAccess.mockResolvedValueOnce({ readOnly: true, canSend: false, contactStatus: "unavailable" });
    try {
      const view = await CharacterChatPage({
        params: Promise.resolve({ characterId: "lucia" }),
        searchParams: Promise.resolve({}),
      });

      // No server view is handed down, so the thread keeps its own loading,
      // retry and error path instead of failing the whole page render.
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain('"initialMessages"');
      expect(serialized).toContain('"characterKey":"lucia"');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
