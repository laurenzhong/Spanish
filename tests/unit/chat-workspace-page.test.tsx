import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { contactRail } = vi.hoisted(() => ({
  contactRail: vi.fn((props: { activeCharacterKey?: string }) => (
    <nav data-testid="contact-rail" data-active={props.activeCharacterKey ?? ""} />
  )),
}));

vi.mock("@/src/modules/conversation/ui/conversation-contact-rail", () => ({
  ConversationContactRail: contactRail,
}));

import ChatPage from "@/app/(product)/chat/page";
import CharacterChatLoading from "@/app/(product)/chat/[characterId]/loading";
import ChatLoading from "@/app/(product)/chat/loading";
import { ConversationWorkspaceSkeleton } from "@/src/modules/conversation/ui/conversation-workspace-skeleton";

describe("conversation workspace", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens the contact index with an intentionally empty conversation pane", () => {
    const { container } = render(<ChatPage />);

    expect(screen.getByTestId("contact-rail")).toBeInTheDocument();
    const workspace = container.querySelector(".conversation-workspace");
    expect(workspace).not.toBeNull();
    // Exactly one pane: the contact list. No placeholder copy, no CTA and no
    // empty thread, so the right pane stays empty until a contact is chosen.
    expect(workspace?.children).toHaveLength(1);
    expect(screen.queryByTestId("chat-thread")).not.toBeInTheDocument();
    expect(container.querySelector(".conversation-thread")).toBeNull();
    expect(screen.queryByRole("link", { name: "打开 Lucía 对话" })).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("选择一个对话");
  });

  it("keeps the contact rail and the thread frame while a conversation opens", () => {
    render(<ConversationWorkspaceSkeleton variant="detail" />);

    expect(screen.getByTestId("contact-rail")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-thread-pending")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在打开对话");
    // The generic page-level placeholder must never front a contact switch.
    expect(screen.queryByText("正在准备内容")).not.toBeInTheDocument();
  });

  it("shows only the contact rail while the contact index loads", () => {
    const { container } = render(<ConversationWorkspaceSkeleton variant="workspace" />);

    expect(screen.getByTestId("contact-rail")).toBeInTheDocument();
    expect(container.querySelector(".conversation-thread")).toBeNull();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("routes use the workspace-shaped loading boundary instead of a generic placeholder", () => {
    const indexView = render(<ChatLoading />);
    expect(indexView.container.querySelector(".conversation-page--workspace")).not.toBeNull();
    expect(indexView.container.querySelector(".conversation-thread")).toBeNull();
    indexView.unmount();

    const detailView = render(<CharacterChatLoading />);
    expect(detailView.container.querySelector(".conversation-page--detail")).not.toBeNull();
    expect(detailView.container.querySelector(".conversation-thread")).not.toBeNull();
    expect(detailView.container.textContent).not.toContain("正在准备内容");
  });
});
