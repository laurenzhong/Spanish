import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { conversationCharacterVersion } from "@/src/modules/conversation/domain/character-catalog";

const {
  chatThread,
  resolveCharacter,
  listHistory,
  resolveAccess,
  getDatabase,
  getCurrentUser,
  notFound,
} = vi.hoisted(() => ({
  chatThread: vi.fn((props: { characterKey: string; characterName: string; initialMessages?: unknown; initialMessageId?: string }) => (
    <div
      data-testid="chat-thread"
      data-character={props.characterKey}
      data-name={props.characterName}
      data-hydrated={props.initialMessages ? "true" : "false"}
      data-message-id={props.initialMessageId ?? ""}
    />
  )),
  resolveCharacter: vi.fn(),
  listHistory: vi.fn(),
  resolveAccess: vi.fn(),
  getDatabase: vi.fn(),
  getCurrentUser: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/src/modules/conversation/ui/chat-thread", () => ({ ChatThread: chatThread }));
// The catalog and the publication policy stay real: this suite asserts the
// production gate, not a fixture. The read functions are spies so the suite can
// prove the page never touches the database, the auth service or the history
// while it renders a contact switch.
vi.mock("@/src/modules/conversation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/modules/conversation")>();
  return {
    findConversationCharacter: actual.findConversationCharacter,
    isConversationCharacterDiscoverable: actual.isConversationCharacterDiscoverable,
    resolveConversationCharacter: resolveCharacter,
    listConversationHistory: listHistory,
    resolveHistoryAccess: resolveAccess,
  };
});
vi.mock("@/src/shared/db/client", () => ({ getDatabase }));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser }));
vi.mock("next/navigation", () => ({ notFound }));

import CharacterChatPage from "@/app/(product)/chat/[characterId]/page";

function expectNoRemoteRead() {
  expect(resolveCharacter).not.toHaveBeenCalled();
  expect(listHistory).not.toHaveBeenCalled();
  expect(resolveAccess).not.toHaveBeenCalled();
  expect(getDatabase).not.toHaveBeenCalled();
  expect(getCurrentUser).not.toHaveBeenCalled();
}

function threadProps(): Record<string, unknown> {
  const call = chatThread.mock.calls.at(-1);
  expect(call).toBeDefined();
  return (call?.[0] ?? {}) as Record<string, unknown>;
}

describe("dynamic character chat page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("renders the chosen conversation without any database or auth read", async () => {
    // Switching contacts used to await the character runtime and the whole
    // history wave before the thread could mount, which is what put a page-level
    // loading placeholder in front of every switch. The thread now owns that
    // read, so the page must render with zero remote work.
    vi.stubEnv("DATABASE_URL", "postgres://test.invalid/db");
    const view = await CharacterChatPage({
      params: Promise.resolve({ characterId: "lucia" }),
      searchParams: Promise.resolve({}),
    });
    render(view);

    expect(screen.getByTestId("chat-thread")).toHaveAttribute("data-character", "lucia");
    expect(screen.getByTestId("chat-thread")).toHaveAttribute("data-name", "Lucía Martín");
    // No server view is handed down: the client paints the cached conversation
    // and revalidates, so a switch never waits for the remote read.
    expect(threadProps()).not.toHaveProperty("initialMessages");
    expect(threadProps()).not.toHaveProperty("initialAccess");
    expectNoRemoteRead();
  });

  it("renders the pane only, because the contact rail belongs to the layout", async () => {
    const view = await CharacterChatPage({
      params: Promise.resolve({ characterId: "lucia" }),
      searchParams: Promise.resolve({}),
    });
    const { container } = render(view);

    // A page that rendered its own rail would duplicate it inside the layout.
    expect(container.querySelector(".conversation-contact-rail")).toBeNull();
    expect(container.querySelector(".conversation-workspace")).toBeNull();
    expect(container.querySelector(".conversation-page")).toBeNull();
  });

  it("keeps draft characters on the synchronous coming-soon gate", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test.invalid/db");
    const view = await CharacterChatPage({
      params: Promise.resolve({ characterId: "mateo" }),
      searchParams: Promise.resolve({}),
    });
    const { container } = render(view);

    expect(screen.getByRole("heading", { name: "角色尚未开放" })).toBeInTheDocument();
    expect(screen.getByText(/Mateo Ruiz/)).toBeInTheDocument();
    expect(container.querySelector(".conversation-contact-rail")).toBeNull();
    expect(screen.queryByTestId("chat-thread")).not.toBeInTheDocument();
    expect(chatThread).not.toHaveBeenCalled();
    expectNoRemoteRead();
  });

  it("forwards a message deep link to the thread", async () => {
    const view = await CharacterChatPage({
      params: Promise.resolve({ characterId: "lucia" }),
      searchParams: Promise.resolve({ message: "00000000-0000-4000-8000-000000000123" }),
    });
    render(view);

    expect(screen.getByTestId("chat-thread")).toHaveAttribute(
      "data-message-id",
      "00000000-0000-4000-8000-000000000123",
    );
    expect(threadProps()).toMatchObject({
      initialMessageId: "00000000-0000-4000-8000-000000000123",
      characterVersion: conversationCharacterVersion("lucia") ?? 1,
    });
    expectNoRemoteRead();
  });

  it("reports an unknown character as not found", async () => {
    await expect(CharacterChatPage({
      params: Promise.resolve({ characterId: "unknown" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(chatThread).not.toHaveBeenCalled();
    expectNoRemoteRead();
  });
});
