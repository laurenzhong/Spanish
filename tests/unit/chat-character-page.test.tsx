import { describe, expect, it, vi } from "vitest";

const { chatThread, resolveCharacter } = vi.hoisted(() => ({
  chatThread: vi.fn((props: { characterKey: string; initialMessages?: unknown }) => (
    <div data-testid="chat-thread" data-character={props.characterKey} data-hydrated={props.initialMessages ? "true" : "false"} />
  )),
  resolveCharacter: vi.fn(),
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
}));
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
});
