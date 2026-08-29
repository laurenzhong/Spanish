import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";

describe("ConversationContactRail", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { conversations: [{ conversationId: "c1", characterKey: "lucia", characterName: "Lucía Martín", avatarClass: "avatar--lucia", roleLabel: "主要好友", lastMessageAt: null, lastMessage: null }] } }) }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("only shows friends with a persisted conversation", async () => {
    render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Mateo Ruiz/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Inés García/ })).not.toBeInTheDocument();
  });

  it("reuses the cached list when the active friend changes", async () => {
    const first = render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());
    first.unmount();
    render(<ConversationContactRail activeCharacterKey="mateo" />);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("opens an accessible friend menu and toggles pin, mute, and unread state", async () => {
    const user = userEvent.setup();
    render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());

    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("link", { name: /Lucía Martín/ }) });
    expect(screen.getByRole("menu", { name: "Lucía Martín 的好友操作" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "取消置顶" }));
    expect(screen.queryByLabelText("已置顶")).not.toBeInTheDocument();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("link", { name: /Lucía Martín/ }) });
    await user.click(screen.getByRole("menuitem", { name: "静音通知" }));
    expect(screen.getByRole("link", { name: /Lucía Martín .*已静音/ })).toBeInTheDocument();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("link", { name: /Lucía Martín/ }) });
    await user.click(screen.getByRole("menuitem", { name: "标记为未读" }));
    expect(screen.getByRole("link", { name: /Lucía Martín .*未读.*已静音/ })).toBeInTheDocument();
  });

  it("supports the desktop context menu gesture", async () => {
    const user = userEvent.setup();
    render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());
    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("link", { name: /Lucía Martín/ }) });
    expect(screen.getByRole("menu", { name: "Lucía Martín 的好友操作" })).toBeInTheDocument();
  });

  it("uses the row itself for dragging in reorder mode", async () => {
    const user = userEvent.setup();
    render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /管理 Lucía Martín/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "管理好友顺序" }));
    expect(screen.getByRole("button", { name: "上移 Lucía Martín" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下移 Lucía Martín" })).toBeInTheDocument();
  });

});
