import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("renders server-prefetched contacts before the client refresh completes", () => {
    vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {}));

    render(
      <ConversationContactRail
        activeCharacterKey="mateo"
        initialConversations={[
          {
            conversationId: "c-mateo",
            characterKey: "mateo",
            characterName: "Mateo Ruiz",
            avatarUrl: null,
            avatarClass: "avatar--mateo",
            roleLabel: "好友",
            lastMessageAt: null,
            lastMessage: null,
            isPinned: false,
            isMuted: false,
            sortRank: null,
          },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: /Mateo Ruiz/ })).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已取消置顶"));
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => typeof init?.body === "string" && init.body.includes('"isPinned":false'))).toBe(true);

    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("link", { name: /Lucía Martín/ }) });
    expect(screen.getByRole("menuitem", { name: "置顶此好友" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

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

  it("shows persisted unread counts and marks the conversation read after opening it", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ data: { conversations: [{ conversationId: "c1", characterKey: "lucia", characterName: "Lucía Martín", avatarClass: "avatar--lucia", roleLabel: "主要好友", lastMessageAt: null, lastMessage: null, unreadCount: 4 }] } }) } as Response);
    const user = userEvent.setup();
    render(<ConversationContactRail activeCharacterKey="mateo" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());
    expect(screen.getByLabelText("4 条未读消息")).toHaveTextContent("4");
    await user.click(screen.getByRole("link", { name: /Lucía Martín/ }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => typeof init?.body === "string" && init.body.includes('"markRead":true'))).toBe(true));
  });

  it("cancels a pending mobile long press when the contact list starts scrolling", async () => {
    render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());
    vi.useFakeTimers();

    const row = screen.getByRole("link", { name: /Lucía Martín/ }).closest(".conversation-contact-row-shell");
    expect(row).not.toBeNull();
    fireEvent.touchStart(row!, { touches: [{ clientX: 20, clientY: 20 }] });
    fireEvent.touchMove(row!, { touches: [{ clientX: 20, clientY: 80 }] });
    vi.advanceTimersByTime(500);

    expect(screen.queryByRole("menu", { name: "Lucía Martín 的好友操作" })).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("keeps waiting for a slow conversation list read instead of reporting an unavailable rail", async () => {
    // The list is a read of a remote pooled database: measured against the
    // running app it answers in 0.9-4.9s, and 7.6s when the rail's own
    // concurrent readers are in flight. Crossing a client bound must not be
    // mistaken for an outage, because that state replaces the contacts with
    // "暂时无法加载会话列表。" even though the server still answers 200.
    vi.useFakeTimers();
    try {
      let releaseServer: (() => void) | undefined;
      const serverResponds = new Promise<void>((resolve) => { releaseServer = resolve; });
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const url = String(input);
        if (url !== "/api/v1/conversations") return { ok: true, json: async () => ({ data: {} }) } as Response;
        // Stay in flight until the server answers, but honour the request
        // signal so a client-side timeout really does reject the read.
        const signal = (init as RequestInit | undefined)?.signal ?? undefined;
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
          if (signal?.aborted) { abort(); return; }
          signal?.addEventListener("abort", abort, { once: true });
          void serverResponds.then(() => resolve());
        });
        return { ok: true, json: async () => ({ data: { conversations: [{ conversationId: "c1", characterKey: "lucia", characterName: "Lucía Martín", avatarClass: "avatar--lucia", roleLabel: "主要好友", lastMessageAt: null, lastMessage: null }] } }) } as Response;
      });

      render(<ConversationContactRail activeCharacterKey="lucia" />);
      expect(screen.getByText("正在加载会话……")).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
      expect(screen.queryByText("暂时无法加载会话列表。")).not.toBeInTheDocument();
      expect(screen.getByText("正在加载会话……")).toBeInTheDocument();

      releaseServer?.();
      // The slow read is still a success: hand back to real timers and let the
      // contacts render instead of the unavailable notice.
      vi.useRealTimers();
      expect(await screen.findByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument();
      expect(screen.queryByText("暂时无法加载会话列表。")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the contacts the server handed down when a background refresh fails", async () => {
    const preview = {
      conversationId: "c-lucia",
      characterKey: "lucia",
      characterName: "Lucía Martín",
      avatarUrl: null,
      avatarClass: "avatar--lucia",
      roleLabel: "主要好友",
      lastMessageAt: null,
      lastMessage: null,
      isPinned: true,
      isMuted: false,
      sortRank: null,
    };
    render(<ConversationContactRail activeCharacterKey="lucia" initialConversations={[preview]} />);
    expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument();

    // The server-rendered list is already on screen; a dropped refresh must not
    // replace it with the rail's error state.
    vi.mocked(fetch).mockRejectedValue(new Error("CONTACT_REQUEST_FAILED"));
    await act(async () => {
      window.dispatchEvent(new Event("conversation-list-updated"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByText("暂时无法加载会话列表。")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument();
  });

});
