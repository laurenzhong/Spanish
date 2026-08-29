import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { clearConversationHistoryCache, getCachedConversationHistory } from "@/src/modules/conversation/ui/conversation-history-cache";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("ChatThread persistence status", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    clearConversationHistoryCache();
    vi.unstubAllGlobals();
  });

  it("shows a visible explanation when conversation history is unavailable", async () => {
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("conversation-persistence-status")).toHaveTextContent("聊天记录暂未保存");
    });
  });

  it("keeps the history loader visible until the response body has hydrated", async () => {
    let resolveHistory: ((value: unknown) => void) | undefined;
    const historyBody = new Promise((resolve) => { resolveHistory = resolve; });
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/v1/me") return { ok: false, status: 404 } as Response;
      return {
        ok: true,
        headers: new Headers([["x-conversation-persistence", "available"]]),
        json: () => historyBody,
      } as Response;
    });

    render(<ChatThread characterKey="mateo" characterName="Mateo Ruiz" characterVersion={1} />);

    expect(screen.getByText("正在加载聊天记录……")).toBeInTheDocument();
    expect(screen.queryByText("¡Hola! Cuéntame algo de tu día. Yo te sigo la conversación.")).not.toBeInTheDocument();

    resolveHistory?.({ data: { messages: [{ id: "history-1", role: "user", text: "Hola, Mateo", complete: true }] } });

    expect(await screen.findByText("Hola, Mateo")).toBeInTheDocument();
    expect(screen.queryByText("¡Hola! Cuéntame algo de tu día. Yo te sigo la conversación.")).not.toBeInTheDocument();
  });

  it("shows the cached history immediately while revalidating", async () => {
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "cached-1", role: "user", text: "缓存消息", complete: true }] } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input) => String(input) === "/api/v1/me"
      ? ({ ok: false, status: 404 } as Response)
      : historyResponse);
    const first = render(<ChatThread characterKey="mateo" characterName="Mateo Ruiz" characterVersion={1} />);
    expect(await screen.findByText("缓存消息")).toBeInTheDocument();
    await waitFor(() => expect(getCachedConversationHistory("mateo")).not.toBeNull());
    first.unmount();

    let resolveRefresh: ((value: unknown) => void) | undefined;
    const refreshBody = new Promise((resolve) => { resolveRefresh = resolve; });
    vi.mocked(fetch).mockImplementation(async (input) => String(input) === "/api/v1/me"
      ? ({ ok: false, status: 404 } as Response)
      : ({ ok: true, headers: new Headers(), json: () => refreshBody } as Response));
    render(<ChatThread characterKey="mateo" characterName="Mateo Ruiz" characterVersion={1} />);
    expect(await screen.findByText("缓存消息")).toBeInTheDocument();
    resolveRefresh?.({ data: { messages: [{ id: "fresh-1", role: "character", text: "最新消息", complete: true }] } });
    expect(await screen.findByText("最新消息")).toBeInTheDocument();
  });

  it("opens the sent-message menu and copies only the visible text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "message-1", role: "user", text: "Hola desde el chat", complete: true }] } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input) => String(input) === "/api/v1/me"
      ? ({ ok: false, status: 404 } as Response)
      : historyResponse);
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);

    const message = await screen.findByText("Hola desde el chat");
    fireEvent.contextMenu(message.closest("article")!);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Hola desde el chat"));
  });

  it("shows the quote in the composer without sending it", async () => {
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "message-1", role: "user", text: "引用这条", complete: true }] } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input) => String(input) === "/api/v1/me"
      ? ({ ok: false, status: 404 } as Response)
      : historyResponse);
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);
    const message = await screen.findByText("引用这条");
    fireEvent.contextMenu(message.closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "引用回复" }));
    expect(screen.getByTestId("conversation-composer-quote")).toHaveTextContent("引用这条");
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  });

  it("opens friend-message actions on right click with copy, translate, and quote only", async () => {
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "friend-1", role: "character", text: "¿Quieres tomar un café?", complete: true }] } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/v1/me") return { ok: false, status: 404 } as Response;
      return historyResponse;
    });
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);

    const message = await screen.findByText("¿Quieres tomar un café?");
    fireEvent.contextMenu(message.closest("article")!);
    expect(screen.getByRole("menu", { name: "Lucía Martín 的消息操作" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "翻译" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "引用回复" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "撤回" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "删除" })).not.toBeInTheDocument();
  });

  it("translates a friend message inline and opens the same menu on double click", async () => {
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "friend-2", role: "character", text: "Nos vemos mañana.", complete: true }] } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/v1/me") return { ok: false, status: 404 } as Response;
      if (String(input) === "/api/v1/conversations/translation") {
        return {
          ok: true,
          headers: new Headers([["content-type", "application/json"]]),
          json: async () => ({ data: { text: "明天见。" } }),
        } as Response;
      }
      return historyResponse;
    });
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);

    const message = await screen.findByText("Nos vemos mañana.");
    fireEvent.doubleClick(message.closest("article")!);
    expect(screen.getByRole("menu", { name: "Lucía Martín 的消息操作" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "翻译" }));
    expect(await screen.findByText("明天见。")).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/v1/conversations/translation", expect.objectContaining({ method: "POST" }));
    fireEvent.contextMenu(message.closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "取消翻译" }));
    expect(screen.queryByText("明天见。")).not.toBeInTheDocument();
  });

  it("refreshes on focus and shows a prompt for a new proactive message when reading older messages", async () => {
    let historyCalls = 0;
    const historyResponse = (messages: readonly object[]) => ({
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages } }),
    }) as Response;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/v1/me") return { ok: false, status: 404 } as Response;
      historyCalls += 1;
      return historyResponse(historyCalls === 1
        ? [{ id: "history-1", role: "user", text: "Mensaje anterior", complete: true }]
        : [
            { id: "history-1", role: "user", text: "Mensaje anterior", complete: true },
            { id: "proactive-1", role: "character", text: "Me acordé de ti esta mañana.", sourceType: "proactive", complete: true },
          ]);
    });

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);
    expect(await screen.findByText("Mensaje anterior")).toBeInTheDocument();
    const messages = screen.getByTestId("conversation-thread").querySelector<HTMLElement>(".conversation-thread__messages")!;
    Object.defineProperties(messages, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    fireEvent.scroll(messages);
    expect(screen.getByRole("button", { name: "回到底部 ↓" })).toBeInTheDocument();

    fireEvent(window, new Event("focus"));
    expect(await screen.findByText("Me acordé de ti esta mañana.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "有一条新消息" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "有一条新消息" }));
    expect(screen.queryByRole("button", { name: "有一条新消息" })).not.toBeInTheDocument();
  });

  it("does not label an ordinary character reply as a proactive message", async () => {
    let historyCalls = 0;
    const historyResponse = (messages: readonly object[]) => ({
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages } }),
    }) as Response;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/v1/me") return { ok: false, status: 404 } as Response;
      historyCalls += 1;
      return historyResponse(historyCalls === 1
        ? [{ id: "history-1", role: "user", text: "Mensaje anterior", complete: true }]
        : [
            { id: "history-1", role: "user", text: "Mensaje anterior", complete: true },
            { id: "reply-1", role: "character", text: "Claro, te leo.", sourceType: "conversation", complete: true },
          ]);
    });

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);
    expect(await screen.findByText("Mensaje anterior")).toBeInTheDocument();
    const messages = screen.getByTestId("conversation-thread").querySelector<HTMLElement>(".conversation-thread__messages")!;
    Object.defineProperties(messages, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    fireEvent.scroll(messages);
    fireEvent(window, new Event("focus"));
    expect(await screen.findByText("Claro, te leo.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "有一条新消息" })).not.toBeInTheDocument();
  });

  it("keeps an optimistic message when history revalidation races its persistence", async () => {
    let historyCalls = 0;
    const initialMessages = [{ id: "history-1", role: "character", text: "之前的消息", complete: true }] as const;
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: initialMessages } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/v1/me") return { ok: false, status: 404 } as Response;
      if (init?.method === "POST") return { ok: false, status: 503 } as Response;
      historyCalls += 1;
      return historyResponse;
    });

    const view = render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} initialMessages={initialMessages} />);
    expect(await screen.findByText("之前的消息")).toBeInTheDocument();
    const composer = screen.getByRole("textbox", { name: "写下你想对 Lucía 说的话" });
    fireEvent.change(composer, { target: { value: "这条消息要保留" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByText("这条消息要保留")).toBeInTheDocument();

    view.rerender(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} initialMessages={[...initialMessages]} />);
    await waitFor(() => expect(historyCalls).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("这条消息要保留")).toBeInTheDocument();
  });

  it("deduplicates streamed messages once the server history confirms them", async () => {
    let historyCalls = 0;
    let sentClientMessageId = "";
    let sentGenerationId = "";
    const initialMessages = [{ id: "history-1", role: "character", text: "之前的消息", complete: true }] as const;
    const historyResponse = (messages: readonly object[]) => ({
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages } }),
    }) as Response;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/v1/me") return { ok: false, status: 404 } as Response;
      if (init?.method === "POST") {
        const request = JSON.parse(String(init.body)) as { clientMessageId: string; generationId: string };
        sentClientMessageId = request.clientMessageId;
        sentGenerationId = request.generationId;
        const lines = [
          { type: "meta", protocolVersion: "v1", characterKey: "lucia", characterVersion: 1, generationId: sentGenerationId, messageId: "assistant-1" },
          { type: "delta", generationId: sentGenerationId, messageId: "assistant-1", text: "Estoy aquí." },
          { type: "done", generationId: sentGenerationId, messageId: "assistant-1" },
        ].map((event) => `${JSON.stringify(event)}\n`).join("");
        const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(lines)); controller.close(); } });
        return { ok: true, headers: new Headers([["x-conversation-persistence", "available"]]), body } as Response;
      }
      historyCalls += 1;
      return historyCalls === 1
        ? historyResponse(initialMessages)
        : historyResponse([
            ...initialMessages,
            { id: "server-user-1", clientMessageId: sentClientMessageId, generationId: sentGenerationId, role: "user", text: "Gracias, me ha hecho ilusión leerte.", complete: true },
            { id: "assistant-1", generationId: sentGenerationId, role: "character", text: "Estoy aquí.", complete: true },
          ]);
    });

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} initialMessages={initialMessages} />);
    const composer = screen.getByRole("textbox", { name: "写下你想对 Lucía 说的话" });
    fireEvent.change(composer, { target: { value: "Gracias, me ha hecho ilusión leerte." } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByText("Estoy aquí.")).toBeInTheDocument();
    expect(screen.getAllByText("Gracias, me ha hecho ilusión leerte.")).toHaveLength(1);

    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(historyCalls).toBeGreaterThanOrEqual(2));
    expect(screen.getAllByText("Gracias, me ha hecho ilusión leerte.")).toHaveLength(1);
    expect(screen.getAllByText("Estoy aquí.")).toHaveLength(1);
  });

  it("hides an empty incomplete reply after a stream failure", async () => {
    const initialMessages = [] as const;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/v1/me") return { ok: false, status: 404 } as Response;
      if (init?.method === "POST") {
        const request = JSON.parse(String(init.body)) as { generationId: string };
        const lines = [
          { type: "meta", protocolVersion: "v1", characterKey: "lucia", characterVersion: 1, generationId: request.generationId, messageId: "assistant-failed" },
          { type: "error", generationId: request.generationId, messageId: "assistant-failed", code: "stream-failed", retryable: true },
        ].map((event) => `${JSON.stringify(event)}\n`).join("");
        const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(lines)); controller.close(); } });
        return { ok: true, headers: new Headers([["x-conversation-persistence", "available"]]), body } as Response;
      }
      return { ok: true, headers: new Headers(), json: async () => ({ data: { messages: initialMessages } }) } as Response;
    });

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} initialMessages={initialMessages} />);
    const composer = screen.getByRole("textbox", { name: "写下你想对 Lucía 说的话" });
    fireEvent.change(composer, { target: { value: "Suena muy bien, ¿lo comes a menudo?" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByText("Suena muy bien, ¿lo comes a menudo?")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("没有完整送达");
    expect(screen.queryByText("…")).not.toBeInTheDocument();
  });
});
