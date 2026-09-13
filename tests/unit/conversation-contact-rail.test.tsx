import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearConversationContactCache, ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";

describe("ConversationContactRail", () => {
  afterEach(() => {
    cleanup();
    clearConversationContactCache();
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { conversations: [{ conversationId: "c1", characterKey: "lucia", characterName: "Lucía Martín", avatarClass: "avatar--lucia", roleLabel: "主要好友", lastMessageAt: null, lastMessage: null }] } }) }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("only shows friends with a persisted conversation", async () => {
    render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(screen.queryByText("最近")).not.toBeInTheDocument();
    expect(screen.queryByText("会话记录会在发送第一条消息后保存。")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Mateo Ruiz/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Inés García/ })).not.toBeInTheDocument();
  });

  it("shows Typing only while a friend is actively replying", async () => {
    render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());

    expect(screen.queryByText("Typing")).not.toBeInTheDocument();
    expect(screen.getByText("主要好友")).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent("conversation-typing", { detail: { characterKey: "lucia", isTyping: true } }));
    await waitFor(() => expect(screen.getByText("Typing")).toBeInTheDocument());
    expect(screen.queryByText("主要好友")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Lucía Martín 正在输入/ })).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent("conversation-typing", { detail: { characterKey: "lucia", isTyping: false } }));
    await waitFor(() => expect(screen.queryByText("Typing")).not.toBeInTheDocument());
    expect(screen.getByText("主要好友")).toBeInTheDocument();
  });

  it("reveals contact search only once the list is large enough to need it", async () => {
    const conversations = Array.from({ length: 8 }, (_, index) => ({
      conversationId: `c${index}`,
      characterKey: index === 0 ? "lucia" : `friend-${index}`,
      characterName: index === 0 ? "Lucía Martín" : `好友 ${index}`,
      avatarClass: "avatar--lucia",
      roleLabel: "好友",
      lastMessageAt: null,
      lastMessage: null,
    }));
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/v1/conversations") return { ok: true, json: async () => ({ data: { conversations } }) } as Response;
      if (url.endsWith("/introductions")) return { ok: true, json: async () => ({ data: { offers: [] } }) } as Response;
      return { ok: true, json: async () => ({ data: { characterKey: "lucia", status: "active" } }) } as Response;
    });

    render(<ConversationContactRail activeCharacterKey="lucia" />);

    expect(await screen.findByRole("search", { name: "搜索对话" })).toBeInTheDocument();
  });

  it("shows a real pending count without a permanent empty inbox action", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/v1/conversations") return { ok: true, json: async () => ({ data: { conversations: [] } }) } as Response;
      if (url.endsWith("/introductions")) return { ok: true, json: async () => ({ data: { offers: [{ offerKey: "offer-1" }] } }) } as Response;
      return { ok: true, json: async () => ({ data: { characterKey: "lucia", status: "pending" } }) } as Response;
    });

    render(<ConversationContactRail />);

    expect(await screen.findByLabelText("2 项待处理")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /待处理/ })).toBeInTheDocument();
  });

  it("reuses the cached list when the active friend changes", async () => {
    const first = render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());
    first.unmount();
    vi.mocked(fetch).mockClear();
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
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已取消置顶"));
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => typeof init?.body === "string" && init.body.includes('"isPinned":false'))).toBe(true);

    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("link", { name: /Lucía Martín/ }) });
    await user.click(screen.getByRole("menuitem", { name: "静音通知" }));
    expect(screen.getByRole("link", { name: /Lucía Martín .*已静音/ })).toBeInTheDocument();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("link", { name: /Lucía Martín/ }) });
    await user.click(screen.getByRole("menuitem", { name: "标记为未读" }));
    expect(screen.getByRole("link", { name: /Lucía Martín .*未读.*已静音/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已标记为未读"));
  });

  it("supports the desktop context menu gesture", async () => {
    const user = userEvent.setup();
    render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());
    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("link", { name: /Lucía Martín/ }) });
    expect(screen.getByRole("menu", { name: "Lucía Martín 的好友操作" })).toBeInTheDocument();
  });

  it("uses the row itself for direct dragging without a management mode", async () => {
    render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "管理好友顺序" })).not.toBeInTheDocument();
    expect(screen.queryByText("拖动好友行调整顺序")).not.toBeInTheDocument();
  });

});
