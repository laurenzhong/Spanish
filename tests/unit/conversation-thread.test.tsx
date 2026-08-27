import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("ChatThread persistence status", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a visible explanation when conversation history is unavailable", async () => {
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("conversation-persistence-status")).toHaveTextContent("聊天记录暂未保存");
    });
  });

  it("opens the sent-message menu and copies only the visible text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "message-1", role: "user", text: "Hola desde el chat", complete: true }] } }),
    } as Response);
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);

    const message = await screen.findByText("Hola desde el chat");
    fireEvent.contextMenu(message.closest("article")!);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Hola desde el chat"));
  });

  it("shows the quote in the composer without sending it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "message-1", role: "user", text: "引用这条", complete: true }] } }),
    } as Response);
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);
    const message = await screen.findByText("引用这条");
    fireEvent.contextMenu(message.closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "引用回复" }));
    expect(screen.getByTestId("conversation-composer-quote")).toHaveTextContent("引用这条");
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  });
});
