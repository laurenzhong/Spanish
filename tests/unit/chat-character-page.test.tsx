import { describe, expect, it, vi } from "vitest";

const { chatThread } = vi.hoisted(() => ({
  chatThread: vi.fn((props: { characterKey: string; initialMessages?: unknown }) => (
    <div data-testid="chat-thread" data-character={props.characterKey} data-hydrated={props.initialMessages ? "true" : "false"} />
  )),
}));

vi.mock("@/src/modules/conversation/ui/chat-thread", () => ({ ChatThread: chatThread }));
vi.mock("@/src/modules/conversation/ui/conversation-contact-rail", () => ({
  ConversationContactRail: (props: { activeCharacterKey: string }) => <nav data-testid="contact-rail" data-active={props.activeCharacterKey} />,
}));
vi.mock("@/src/modules/conversation", () => ({
  findConversationCharacter: (key: string) => ({
    key,
    displayName: key === "mateo" ? "Mateo Ruiz" : "Lucía Martín",
    roleLabel: "好友",
    version: 1,
    avatarClass: "avatar--lucia",
  }),
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

import CharacterChatPage from "@/app/(product)/chat/[characterId]/page";

describe("dynamic character chat page", () => {
  it("returns the route shell without blocking on server history", async () => {
    const view = await CharacterChatPage({
      params: Promise.resolve({ characterId: "mateo" }),
      searchParams: Promise.resolve({}),
    });

    expect(view).toBeTruthy();
    const workspace = (view as { props: { children: { props: { children: unknown[] } } } }).props.children;
    const threadElement = workspace.props.children[1] as { props: Record<string, unknown> };
    expect(threadElement.props).toEqual(expect.objectContaining({ characterKey: "mateo", initialMessageId: undefined }));
    expect(threadElement.props).not.toHaveProperty("initialMessages");
  });
});
