import { readAloudFake as speech } from "../helpers/read-aloud-fake";
vi.mock("@/src/modules/providers/tts/read-aloud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/modules/providers/tts/read-aloud")>();
  const { readAloudFake } = await import("../helpers/read-aloud-fake");
  return { ...actual, createReadAloud: readAloudFake.create };
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { clearConversationHistoryCache, getCachedConversationHistory, setCachedConversationHistory } from "@/src/modules/conversation/ui/conversation-history-cache";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("ChatThread persistence status", () => {
  beforeEach(() => {
    speech.reset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    clearConversationHistoryCache();
    vi.unstubAllGlobals();
  });

  it("shows one recoverable error and disables the composer when conversation history is unavailable", async () => {
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("conversation-persistence-status")).toHaveTextContent("暂时无法打开这段对话");
    });
    expect(screen.getAllByRole("button", { name: "重试" })).toHaveLength(1);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    expect(screen.queryByText(/DATABASE_URL/)).not.toBeInTheDocument();
  });

  it("keeps pending contact history read-only and never renders a composer", async () => {
    setCachedConversationHistory("lucia", [{ id: "pending-history-1", role: "character", text: "Te escribiré cuando aceptes.", complete: true }], {
      readOnly: true,
      canSend: false,
      contactStatus: "pending",
    });

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);

    expect(await screen.findByText("Te escribiré cuando aceptes.")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-composer-locked")).toHaveTextContent("接受好友申请后才能发送消息");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送消息" })).not.toBeInTheDocument();
  });

  it("keeps the header to identity, relationship state, and one contextual menu", async () => {
    const user = userEvent.setup();
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" roleLabel="熟悉的朋友" characterVersion={1} initialMessages={[]} />);

    expect(screen.getByRole("heading", { name: "Lucía Martín" })).toBeInTheDocument();
    expect(screen.getByText("熟悉的朋友")).toBeInTheDocument();
    expect(screen.queryByRole("search", { name: "搜索对话" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更多对话操作" }));
    expect(screen.getByRole("menu", { name: "对话操作" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "搜索消息" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "关系资料与清理" })).toHaveAttribute("href", "/me#profile-relationships");
  });

  it("uses one natural sentence for an empty conversation", () => {
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} initialMessages={[]} />);

    expect(screen.getByText("¡Hola! Cuéntame algo de tu día.")).toBeInTheDocument();
    expect(screen.queryByText("Lucía Martín 的消息")).not.toBeInTheDocument();
    expect(screen.queryByText("Yo te sigo la conversación.")).not.toBeInTheDocument();
  });

  it("uses plain adaptive bubbles for both sides without decorative image assets", async () => {
    render(
      <ChatThread
        characterKey="mateo"
        characterName="Mateo Ruiz"
        characterVersion={1}
        initialMessages={[
          { id: "mateo-character-1", role: "character", text: "Hola", complete: true },
          { id: "mateo-user-1", role: "user", text: "Primera línea\nSegunda línea", complete: true },
        ]}
      />,
    );

    const shortBubble = screen.getByText("Hola").closest<HTMLElement>(".conversation-message__bubble");
    const multilineBubble = screen.getByText(/Primera línea/).closest<HTMLElement>(".conversation-message__bubble");
    expect(shortBubble).toBeInTheDocument();
    expect(multilineBubble).toBeInTheDocument();
    expect(document.querySelector(".conversation-art-bubble")).not.toBeInTheDocument();
    expect(document.querySelector(".conversation-message__bubble img")).not.toBeInTheDocument();
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
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
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
    expect(screen.queryByRole("button", { name: "消息操作" })).not.toBeInTheDocument();
    fireEvent.contextMenu(message.closest("article")!);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["复制", "引用回复", "撤回", "删除"]);
    expect(screen.queryByRole("menuitem", { name: "转发" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Hola desde el chat"));
  });

  it("aligns the context menu to the selected bubble instead of the pointer", async () => {
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "position-1", role: "user", text: "位置测试", complete: true }] } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input) => String(input) === "/api/v1/me"
      ? ({ ok: false, status: 404 } as Response)
      : historyResponse);
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);
    const message = (await screen.findByText("位置测试")).closest("article")!;
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getRect(this: HTMLElement) {
      if (this.classList.contains("conversation-message__bubble")) {
        return { left: 300, right: 500, top: 100, bottom: 200, width: 200, height: 100, x: 300, y: 100, toJSON: () => ({}) };
      }
      if (this.classList.contains("conversation-message-menu")) {
        return { left: 0, right: 152, top: 0, bottom: 146, width: 152, height: 146, x: 0, y: 0, toJSON: () => ({}) };
      }
      return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
    });
    fireEvent.contextMenu(message, { clientX: 420, clientY: 150 });
    const menu = screen.getByRole("menu");
    rectSpy.mockRestore();
    expect(menu).toHaveStyle({ left: "348px", top: "206px" });
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
    expect(screen.getByRole("menuitem", { name: "朗读" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "引用回复" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "撤回" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "删除" })).not.toBeInTheDocument();
  });

  it("reads a friend message from the message menu and can stop it", async () => {
    speech.reset();
    speech.state.completeImmediately = true;
    const speak = speech.speak;

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} initialMessages={[{ id: "speak-1", role: "character", text: "¿Quieres tomar un café?", complete: true }]} />);
    const message = screen.getByText("¿Quieres tomar un café?");
    fireEvent.contextMenu(message.closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "朗读" }));
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
    expect(speak.mock.calls[0]?.[0].text).toBe("¿Quieres tomar un café?");
  });

  it("keeps a restarted message active when the cancelled attempt settles", async () => {
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} initialMessages={[{ id: "same-message", role: "character", text: "Hola, ¿qué tal?", complete: true }]} />);
    const row = screen.getByText("Hola, ¿qué tal?").closest("article")!;
    const openMenu = () => fireEvent.contextMenu(row);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "朗读" }));
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "停止朗读" }));
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "朗读" }));
    await act(async () => undefined);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "停止朗读" })).toBeInTheDocument();
    expect(screen.queryByText("暂时无法朗读，请稍后重试")).not.toBeInTheDocument();
    await act(async () => speech.attempts.at(-1)!.onend?.());
    expect(screen.getByRole("menuitem", { name: "朗读" })).toBeInTheDocument();
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
    expect(screen.queryByRole("menu", { name: "Lucía Martín 的消息操作" })).not.toBeInTheDocument();
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

  it("keeps the open conversation usable when only the send fails", async () => {
    // A rejected send (validation, contact gate, provider outage) answers with
    // an error status and no persistence header. That is a send failure, not a
    // history failure: reporting it as an unopenable conversation also locked
    // the composer and hid a conversation that had loaded correctly.
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "open-1", role: "character", text: "¿Qué tal tu día?", complete: true }] } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/v1/me") return { ok: false, status: 404 } as Response;
      if (init?.method === "POST") return { ok: false, status: 403, headers: new Headers() } as Response;
      return historyResponse;
    });

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);
    expect(await screen.findByText("¿Qué tal tu día?")).toBeInTheDocument();

    const composer = screen.getByRole("textbox", { name: "写下你想对 Lucía 说的话" });
    fireEvent.change(composer, { target: { value: "Todo bien, gracias." } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(await screen.findByText("这次回复没有完整送达，未产生任何学习评分。")).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-persistence-status")).not.toBeInTheDocument();
    expect(screen.getByText("¿Qué tal tu día?")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "写下你想对 Lucía 说的话" })).toBeEnabled();
  });

  it("keeps waiting for a slow history read instead of reporting an unavailable database", async () => {
    // Reading an established conversation is several sequential round trips to
    // a remote database and has been measured well past 8s. Crossing a client
    // bound must not be mistaken for an outage, because that state locks the
    // composer even though the server still answers with the full history.
    vi.useFakeTimers();
    try {
      let releaseServer: (() => void) | undefined;
      const serverResponds = new Promise<void>((resolve) => { releaseServer = resolve; });
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (String(input) === "/api/v1/me") return { ok: false, status: 404 } as Response;
        // Stay in flight until the server answers, but honour the request
        // signal so a client-side timeout really does reject the read.
        const signal = (init as RequestInit | undefined)?.signal ?? undefined;
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
          if (signal?.aborted) { abort(); return; }
          signal?.addEventListener("abort", abort, { once: true });
          void serverResponds.then(() => resolve());
        });
        return {
          ok: true,
          headers: new Headers([["x-conversation-persistence", "available"]]),
          json: async () => ({ data: { messages: [{ id: "slow-1", role: "character", text: "Siento la tardanza.", complete: true }] } }),
        } as Response;
      });

      render(<ChatThread characterKey="mateo" characterName="Mateo Ruiz" characterVersion={1} />);
      expect(screen.getByText("正在加载聊天记录……")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(12_000);
      expect(screen.queryByTestId("conversation-persistence-status")).not.toBeInTheDocument();
      expect(screen.getByText("正在加载聊天记录……")).toBeInTheDocument();

      releaseServer?.();
      // The slow read is still a success: hand back to real timers and let the
      // hydrated history render instead of a database-unavailable notice.
      vi.useRealTimers();
      expect(await screen.findByText("Siento la tardanza.")).toBeInTheDocument();
      expect(screen.queryByTestId("conversation-persistence-status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a server-rendered history when the background revalidation fails", async () => {
    // The page now ships the conversation with the HTML. A failed revalidation
    // must not overwrite that view with "cannot open this conversation", which
    // is what happened when only a client-side cache counted as a fallback.
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);

    render(
      <ChatThread
        characterKey="mateo"
        characterName="Mateo Ruiz"
        characterVersion={1}
        initialMessages={[{ id: "server-1", role: "character", text: "Ya te escribí.", complete: true }]}
        initialAccess={{ readOnly: false, canSend: true, contactStatus: "active" }}
      />,
    );

    expect(screen.getByText("Ya te escribí.")).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByTestId("conversation-persistence-status")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "写下你想对 Mateo Ruiz 说的话" })).toBeEnabled();
  });

  it("honours the server-rendered contact gate instead of optimistically allowing a send", async () => {
    // A pending contact must never render a composer, even for one paint.
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);

    render(
      <ChatThread
        characterKey="mateo"
        characterName="Mateo Ruiz"
        characterVersion={1}
        initialMessages={[{ id: "server-pending", role: "character", text: "Te escribiré cuando aceptes.", complete: true }]}
        initialAccess={{ readOnly: true, canSend: false, contactStatus: "pending" }}
      />,
    );

    expect(screen.getByText("Te escribiré cuando aceptes.")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-composer-locked")).toHaveTextContent("接受好友申请后才能发送消息");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("deletes an own message only after the shared confirm dialog succeeds", async () => {
    const confirmSpy = vi.fn(() => false);
    // The native browser prompt must never be the confirmation path again.
    vi.stubGlobal("confirm", confirmSpy);
    const actionRequests: Array<{ url: string; method: string | undefined }> = [];
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "delete-1", role: "user", text: "这条消息要删除", complete: true }] } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/v1/me") return { ok: false, status: 404 } as Response;
      if (url.includes("/messages/")) {
        actionRequests.push({ url, method: init?.method });
        return { ok: true, status: 200 } as Response;
      }
      return historyResponse;
    });

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);
    const message = await screen.findByText("这条消息要删除");
    fireEvent.contextMenu(message.closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));

    const dialog = await screen.findByRole("alertdialog", { name: "删除这条消息？" });
    // Opening the dialog sends nothing and asks no native prompt.
    expect(actionRequests).toEqual([]);
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(actionRequests).toEqual([{ url: "/api/v1/conversations/lucia/messages/delete-1", method: "DELETE" }]));
    await waitFor(() => expect(screen.queryByText("这条消息要删除")).not.toBeInTheDocument());
    expect(screen.getByText("消息已删除")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // The deleted row is gone, so focus lands on the transcript rather than on
    // the removed menu item.
    await waitFor(() => expect(document.querySelector(".conversation-thread__messages")).toHaveFocus());
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("sends nothing when the withdraw confirmation is dismissed", async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    const actionRequests: string[] = [];
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "withdraw-1", role: "user", text: "这条消息要撤回", complete: true }] } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/v1/me") return { ok: false, status: 404 } as Response;
      if (url.includes("/messages/")) {
        actionRequests.push(`${init?.method ?? "GET"} ${url}`);
        return { ok: true, status: 200 } as Response;
      }
      return historyResponse;
    });

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);
    const message = await screen.findByText("这条消息要撤回");
    fireEvent.contextMenu(message.closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "撤回" }));

    const dialog = await screen.findByRole("alertdialog", { name: "撤回这条消息？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(actionRequests).toEqual([]);
    expect(screen.getByText("这条消息要撤回")).toBeInTheDocument();
    expect(screen.queryByText("你撤回了一条消息")).not.toBeInTheDocument();
    // The menu stays mounted behind the dialog, so focus returns to its item.
    expect(screen.getByRole("menuitem", { name: "撤回" })).toHaveFocus();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the failure message when the withdraw request fails", async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "withdraw-failed", role: "user", text: "这条消息要撤回", complete: true }] } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/v1/me") return { ok: false, status: 404 } as Response;
      if (url.includes("/messages/")) return { ok: false, status: 500 } as Response;
      return historyResponse;
    });

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);
    const message = await screen.findByText("这条消息要撤回");
    fireEvent.contextMenu(message.closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "撤回" }));

    const dialog = await screen.findByRole("alertdialog", { name: "撤回这条消息？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认撤回" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("撤回没有完成，消息仍保留在对话中");
    expect(screen.getByRole("alertdialog", { name: "撤回这条消息？" })).toBeInTheDocument();
    expect(screen.getByText("这条消息要撤回")).toBeInTheDocument();
    expect(screen.queryByText("你撤回了一条消息")).not.toBeInTheDocument();
    expect(screen.queryByText("消息已撤回，且不会用于记忆或学习数据")).not.toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("keeps the 409 reason visible while the withdraw dialog stays open", async () => {
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "withdraw-late", role: "user", text: "太晚撤回的消息", complete: true }] } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/v1/me") return { ok: false, status: 404 } as Response;
      if (url.includes("/messages/")) return { ok: false, status: 409 } as Response;
      return historyResponse;
    });

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);
    const message = await screen.findByText("太晚撤回的消息");
    fireEvent.contextMenu(message.closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "撤回" }));

    const dialog = await screen.findByRole("alertdialog", { name: "撤回这条消息？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认撤回" }));

    expect(await screen.findByText("这条消息已超过可撤回时间")).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("太晚撤回的消息")).toBeInTheDocument();
  });

  it("closes only the dialog on Escape and returns focus to its menu item", async () => {
    const user = userEvent.setup();
    const historyResponse = {
      ok: true,
      headers: new Headers([["x-conversation-persistence", "available"]]),
      json: async () => ({ data: { messages: [{ id: "withdraw-escape", role: "user", text: "按 Escape 的消息", complete: true }] } }),
    } as Response;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/v1/me") return { ok: false, status: 404 } as Response;
      if (url.includes("/messages/")) return { ok: true, status: 200 } as Response;
      return historyResponse;
    });

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);
    const message = await screen.findByText("按 Escape 的消息");
    fireEvent.contextMenu(message.closest("article")!);
    await user.click(screen.getByRole("menuitem", { name: "撤回" }));

    expect(await screen.findByRole("alertdialog", { name: "撤回这条消息？" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // Escape is consumed by the dialog first: the menu underneath it survives
    // and its item takes focus back.
    expect(screen.getByRole("menu", { name: "你的消息操作" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "撤回" })).toHaveFocus();
  });
});
