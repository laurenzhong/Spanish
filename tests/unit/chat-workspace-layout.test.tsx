import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { contactRail, params } = vi.hoisted(() => ({
  contactRail: vi.fn((props: { activeCharacterKey?: string; initialConversations?: readonly unknown[] }) => (
    <nav
      data-testid="contact-rail"
      data-active={props.activeCharacterKey ?? ""}
      data-initial={props.initialConversations === undefined ? "none" : String(props.initialConversations.length)}
    />
  )),
  params: { characterId: "lucia" } as { characterId?: string },
}));

vi.mock("@/src/modules/conversation/ui/conversation-contact-rail", () => ({
  ConversationContactRail: contactRail,
}));
// The layout's async rail child is covered by conversation-rail-data.test.tsx;
// here it only has to stand in for the streamed rail.
vi.mock("@/app/(product)/chat/_contact-rail-data", () => ({
  default: () => <nav data-testid="rail-host" />,
}));
vi.mock("next/navigation", () => ({ useParams: () => params }));

import ChatLayout from "@/app/(product)/chat/layout";
import ChatPage from "@/app/(product)/chat/page";
import ChatLoading from "@/app/(product)/chat/loading";
import CharacterChatLoading from "@/app/(product)/chat/[characterId]/loading";
import { ConversationRailHost } from "@/src/modules/conversation/ui/conversation-rail-host";
import {
  ConversationRailSkeleton,
  ConversationThreadSkeleton,
} from "@/src/modules/conversation/ui/conversation-workspace-skeleton";

describe("conversation workspace layout", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    params.characterId = "lucia";
  });

  it("owns the contact rail and keeps it while a conversation is rendered", () => {
    const { container } = render(
      <ChatLayout>
        <section data-testid="pane" />
      </ChatLayout>,
    );

    const workspace = container.querySelector(".conversation-workspace");
    expect(workspace).not.toBeNull();
    // The rail lives in the layout, so it is mounted once and reused while the
    // user switches contacts instead of being re-rendered by every page.
    expect(screen.getByTestId("rail-host")).toBeInTheDocument();
    expect(screen.getByTestId("pane")).toBeInTheDocument();
    expect(workspace?.children).toHaveLength(2);
    expect(container.querySelector(".conversation-page--detail")).not.toBeNull();
  });

  it("opens the index with the contacts on the left and a chooser prompt in the empty pane", () => {
    const { container } = render(<ChatPage />);

    // Still no thread frame, so the rail keeps the pane on small screens, but
    // the desktop pane explains what to do instead of staying blank.
    expect(container.querySelector(".conversation-thread")).toBeNull();
    expect(container.querySelector(".conversation-empty")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "选择一个好友开始对话" })).toBeInTheDocument();
  });

  it("has nothing of its own to show while the index settles", () => {
    const { container } = render(<ChatLoading />);

    expect(container.textContent).toBe("");
  });

  it("shows a thread frame instead of a page placeholder while a conversation opens", () => {
    const { container } = render(<CharacterChatLoading />);

    expect(container.querySelector(".conversation-thread--pending")).not.toBeNull();
    expect(container.querySelector(".conversation-contact-rail")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("正在打开对话");
    expect(container.textContent).not.toContain("正在准备内容");
  });

  it("derives the active contact from the route instead of a page prop", () => {
    render(<ConversationRailHost initialConversations={[]} />);

    expect(contactRail).toHaveBeenCalledWith(
      { activeCharacterKey: "lucia", initialConversations: [] },
      undefined,
    );
    expect(screen.getByTestId("contact-rail")).toHaveAttribute("data-active", "lucia");
  });

  it("keeps the rail unhighlighted on the contact index", () => {
    params.characterId = undefined;
    render(<ConversationRailHost />);

    expect(screen.getByTestId("contact-rail")).toHaveAttribute("data-active", "");
    expect(screen.getByTestId("contact-rail")).toHaveAttribute("data-initial", "none");
  });

  it("keeps the rail skeleton shaped like the contact list", () => {
    const { container } = render(<ConversationRailSkeleton />);

    expect(container.querySelector(".conversation-contact-rail")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载会话");
    expect(container.querySelector(".conversation-thread")).toBeNull();
  });

  it("renders the thread skeleton without a competing rail", () => {
    const { container } = render(<ConversationThreadSkeleton />);

    expect(container.querySelector(".conversation-thread--pending")).not.toBeNull();
    expect(container.querySelector(".conversation-contact-rail")).toBeNull();
  });
});
