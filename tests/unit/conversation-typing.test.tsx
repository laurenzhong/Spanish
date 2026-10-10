import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { clearConversationHistoryCache } from "@/src/modules/conversation/ui/conversation-history-cache";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("conversation typing status", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    clearConversationHistoryCache();
    vi.unstubAllGlobals();
  });

  it("announces an active reply once and restores the role label after done", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let sentGenerationId = "";
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      if (String(input) === "/api/v1/me") return { ok: false, status: 404 } as Response;
      if (init?.method === "POST") {
        sentGenerationId = (JSON.parse(String(init.body)) as { generationId: string }).generationId;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          },
        });
        return {
          ok: true,
          headers: new Headers([["x-conversation-persistence", "available"]]),
          body,
        } as Response;
      }
      return {
        ok: true,
        headers: new Headers([["x-conversation-persistence", "available"]]),
        json: async () => ({ data: { messages: [] } }),
      } as Response;
    }));

    render(
      <ChatThread
        characterKey="lucia"
        characterName="Lucía Martín"
        roleLabel="主要好友"
        characterVersion={1}
      />,
    );
    expect(screen.getByText("主要好友")).toBeInTheDocument();

    const composer = await screen.findByRole("textbox", { name: "写下你想对 Lucía 说的话" });
    await waitFor(() => expect(composer).toBeEnabled());
    fireEvent.change(composer, {
      target: { value: "Hola" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    const typing = await waitFor(() => {
      const indicator = document.querySelector(".conversation-thread__typing");
      expect(indicator).toBeInTheDocument();
      return indicator as HTMLElement;
    });
    expect(typing).toHaveClass("conversation-thread__typing");
    expect(typing).toHaveTextContent("Typing");
    expect(typing).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("status")).toHaveTextContent("正在回复");
    expect(screen.queryByText("主要好友")).not.toBeInTheDocument();

    const events = [
      { type: "meta", protocolVersion: "v1", characterKey: "lucia", characterVersion: 1, generationId: sentGenerationId, messageId: "assistant-1" },
      { type: "done", generationId: sentGenerationId, messageId: "assistant-1" },
    ].map((event) => `${JSON.stringify(event)}\n`).join("");
    streamController?.enqueue(new TextEncoder().encode(events));
    streamController?.close();

    await waitFor(() => expect(screen.queryByText("Typing")).not.toBeInTheDocument());
    expect(screen.getByText("主要好友")).toBeInTheDocument();
  });
});
