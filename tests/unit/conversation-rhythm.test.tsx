import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { clearConversationHistoryCache } from "@/src/modules/conversation/ui/conversation-history-cache";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

type Request = { text: string; clientMessageId: string; generationId: string; pendingMessages?: Array<{ text: string; clientMessageId: string }>; supersedes?: { generationId: string; visibleBubbleCount: number } };
const requests: Request[] = [];
const streams: Array<{ emit: (type: string, text?: string) => void; close: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
let history: unknown[] = [];
let canSend = true;

function send(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
}
function mount() { return render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={3} initialMessages={[]} />); }

beforeEach(() => {
  requests.length = 0; streams.length = 0; history = []; canSend = true;
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (String(input).endsWith("/stream") && init?.method === "POST") {
      const request = JSON.parse(String(init.body)) as Request;
      requests.push(request);
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.push({
            emit: (type, text) => controller.enqueue(new TextEncoder().encode(JSON.stringify({ type, generationId: request.generationId, messageId: `a-${request.generationId}`, ...(type === "meta" ? { protocolVersion: "v1", characterKey: "lucia", characterVersion: 3 } : {}), ...(text ? { text } : {}) }) + "\n")),
            close: () => controller.close(), cancel,
          });
        }, cancel,
      });
      return new Response(body, { headers: { "x-conversation-persistence": "available" } });
    }
    if (String(input) === "/api/v1/me") return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ data: { messages: history, readOnly: !canSend, canSend, contactStatus: "active", conversations: [] } }));
  }));
});
afterEach(() => { cleanup(); clearConversationHistoryCache(); vi.unstubAllGlobals(); });

describe("natural conversation bubbles and follow-ups", () => {
  it.each(["DELETE", "PATCH"])("synchronizes authoritative dependent-reply removal after %s without touching an unrelated stream or draft", async (method) => {
    const source = { id: "source", clientMessageId: "source-client", role: "user", text: "Remove this source", complete: true };
    const shared = { id: "shared", role: "character", text: "Server retained a reply with another source.", complete: true };
    history = [source, { id: "dependent", role: "character", text: "A reply dependent on that source.", complete: true }, shared];
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (String(input).includes("/messages/") && init?.method === method) {
        const active = requests[0]!;
        history = [...(method === "PATCH" ? [{ ...source, text: "", withdrawn: true, status: "withdrawn" }] : []), shared,
          { id: `a-${active.generationId}`, generationId: active.generationId, role: "character", text: "Unrelated", complete: false }];
        return Promise.resolve(new Response("{}"));
      }
      return original(input, init);
    });
    mount(); await screen.findByText(source.text);
    send("An unrelated new request"); await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => { streams[0]!.emit("meta"); streams[0]!.emit("delta", "Unrelated live prefix."); });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep this draft" } });
    fireEvent.contextMenu(screen.getByText(source.text).closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: method === "PATCH" ? "撤回" : "删除" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: method === "PATCH" ? "确认撤回" : "确认删除" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByText("A reply dependent on that source.")).not.toBeInTheDocument();
    expect(screen.getByText(shared.text)).toBeInTheDocument();
    expect(screen.getByText("Unrelated live prefix.")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Keep this draft");
    expect(streams[0]!.cancel).not.toHaveBeenCalled();
    await act(async () => { streams[0]!.emit("delta", " Continues."); streams[0]!.emit("done"); streams[0]!.close(); });
    expect(screen.getByText("Unrelated live prefix. Continues.")).toBeInTheDocument();
  });

  it("cancels a batch using a removed source, clears its tombstoned prefix and retains the other pending id for explicit retry", async () => {
    mount(); send("Source to remove"); send("Keep this pending message");
    await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => { streams[0]!.emit("meta"); streams[0]!.emit("delta", "Invalidated visible prefix."); });
    const sent = requests[0]!;
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (String(input).includes("/messages/") && init?.method === "DELETE") {
        history = [
          { id: sent.clientMessageId, clientMessageId: sent.clientMessageId, role: "user", text: sent.text, complete: true },
        ];
        return Promise.resolve(new Response("{}"));
      }
      return original(input, init);
    });
    fireEvent.contextMenu(screen.getByText("Source to remove").closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(streams[0]!.cancel).toHaveBeenCalled();
    expect(screen.queryByText("Invalidated visible prefix.")).not.toBeInTheDocument();
    expect(screen.getByText("Keep this pending message")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "重新发送" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({ text: sent.text, clientMessageId: sent.clientMessageId });
    expect(requests[1]?.pendingMessages).toBeUndefined();
    expect(requests[1]?.supersedes).toBeUndefined();
  });

  it("does not offer to retry an older completed turn after deleting the only pending source", async () => {
    history = [
      { id: "answered-user", role: "user", text: "An answered question", complete: true },
      { id: "answered-reply", role: "character", text: "A completed answer", complete: true },
    ];
    mount(); await screen.findByText("A completed answer");
    send("The only pending source"); await waitFor(() => expect(streams).toHaveLength(1));
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => String(input).includes("/messages/") && init?.method === "DELETE"
      ? Promise.resolve(new Response("{}")) : original(input, init));
    fireEvent.contextMenu(screen.getByText("The only pending source").closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "重新发送" })).not.toBeInTheDocument();
    expect(streams[0]!.cancel).toHaveBeenCalled();
    expect(screen.getByText("A completed answer")).toBeInTheDocument();
  });

  it("ignores a late mutation history refresh after changing characters", async () => {
    history = [{ id: "source", role: "user", text: "Old character source", complete: true }];
    const original = vi.mocked(fetch).getMockImplementation()!;
    let mutationSucceeded = false;
    let resolveHistory: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (String(input).includes("/messages/") && init?.method === "DELETE") {
        mutationSucceeded = true;
        return Promise.resolve(new Response("{}"));
      }
      if (String(input) === "/api/v1/conversations/lucia" && mutationSucceeded) return new Promise<Response>((resolve) => { resolveHistory = resolve; });
      return original(input, init);
    });
    const view = mount(); await screen.findByText("Old character source");
    fireEvent.contextMenu(screen.getByText("Old character source").closest("article")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(resolveHistory).toBeDefined());
    history = [];
    view.rerender(<ChatThread characterKey="mateo" characterName="Mateo Ruiz" characterVersion={1} initialMessages={[]} />);
    await act(async () => { resolveHistory!(new Response(JSON.stringify({ data: { messages: [{ id: "stale", role: "character", text: "Late old-character reply", complete: true }], canSend: true } }))); });
    expect(screen.queryByText("Late old-character reply")).not.toBeInTheDocument();
    expect(screen.queryByText("消息已删除")).not.toBeInTheDocument();
  });

  it("recovers the full unanswered server tail and cancelled prefix only when the user retries", async () => {
    history = [
      { id: "old-user", role: "user", text: "An older topic", complete: true },
      { id: "old-answer", role: "character", text: "Finished.", complete: true },
      ...Array.from({ length: 6 }, (_, index) => ({ id: `db-${index}`, clientMessageId: `pending-${index}`, role: "user", text: `${index}-${"x".repeat(1500)}`, complete: true, ...(index === 0 ? { sourceType: "translation_assisted" } : {}) })),
      { id: "partial", role: "character", generationId: "old-generation", text: "Uno.\r\rDos.", complete: true, status: "cancelled" },
      { id: "proactive", role: "character", text: "A proactive greeting.", complete: true, sourceType: "proactive" },
    ];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "重新发送" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.clientMessageId).toBe("pending-5");
    expect(requests[0]?.pendingMessages?.map((message) => message.clientMessageId)).toEqual(["pending-0", "pending-1", "pending-2", "pending-3", "pending-4"]);
    expect(requests[0]?.pendingMessages?.[0]).toMatchObject({ assistance: "translation" });
    expect(requests[0]?.supersedes).toEqual({ generationId: "old-generation", visibleBubbleCount: 2 });
    expect(screen.getByText("Dos.")).toBeInTheDocument();
    expect(document.querySelectorAll(".conversation-message--user")).toHaveLength(7);
  });

  it("does not send recovered optimistic messages automatically and combines them on the next explicit send", async () => {
    const view = mount(); send("Me gustan las fotos."); send("Compré un libro.");
    await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => { streams[0]!.emit("meta"); streams[0]!.emit("delta", "Uno."); streams[0]!.emit("delta", "\n\nDos."); });
    const prior = requests[0]!;
    view.unmount(); mount();
    await screen.findByText("Dos.");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); });
    expect(requests).toHaveLength(1);
    send("Y otra cosa.");
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.pendingMessages).toEqual([...prior.pendingMessages!, { text: prior.text, clientMessageId: prior.clientMessageId }]);
    expect(requests[1]?.supersedes).toEqual({ generationId: prior.generationId, visibleBubbleCount: 2 });
  });

  it("does not treat an authored opening as answering restored user messages", async () => {
    history = [
      { id: "unanswered", clientMessageId: "unanswered-client", role: "user", text: "Hola otra vez", complete: true },
      { id: "opening", role: "character", text: "Authored greeting", complete: true, sourceType: "authored_opening" },
    ];
    mount(); await screen.findByRole("button", { name: "重新发送" });
    expect(requests).toHaveLength(0);
    send("Una pregunta más.");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.pendingMessages).toEqual([{ text: "Hola otra vez", clientMessageId: "unanswered-client" }]);
  });

  it("renders four paragraphs as four bubbles but keeps single newlines and actions on the whole turn", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mount(); send("Explícame cuatro cosas.");
    await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => {
      streams[0]!.emit("meta");
      streams[0]!.emit("delta", "Primera línea.\nSigue aquí.");
      streams[0]!.emit("delta", "\n\nSegunda."); streams[0]!.emit("delta", "\n\nTercera."); streams[0]!.emit("delta", "\n\nCuarta.");
      streams[0]!.emit("done"); streams[0]!.close();
    });
    const article = screen.getByLabelText("Lucía Martín 的消息");
    expect(article.querySelectorAll(".conversation-message__bubble")).toHaveLength(4);
    fireEvent.contextMenu(article); fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Primera línea.\nSigue aquí.\n\nSegunda.\n\nTercera.\n\nCuarta."));
  });

  it("coalesces rapid sends with distinct client ids and latest text on top", async () => {
    mount(); send("Me gusta la fotografía urbana."); send("He comprado un libro.");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ text: "He comprado un libro.", pendingMessages: [{ text: "Me gusta la fotografía urbana." }] });
    expect(requests[0]?.pendingMessages?.[0]?.clientMessageId).not.toBe(requests[0]?.clientMessageId);
    expect(document.querySelectorAll(".conversation-message--user")).toHaveLength(2);
  });

  it("restarts for a sent follow-up, preserves the visible prefix, and cancels the old reader", async () => {
    mount(); send("Me gusta hacer fotos.");
    await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => { streams[0]!.emit("meta"); streams[0]!.emit("delta", "Qué buena afición."); });
    send("Y he comprado un libro.");
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(screen.getByText("Qué buena afición.")).toBeInTheDocument();
    expect(streams[0]!.cancel).toHaveBeenCalled();
    expect(requests[1]).toMatchObject({ pendingMessages: [{ text: "Me gusta hacer fotos." }], supersedes: { generationId: requests[0]!.generationId, visibleBubbleCount: 1 } });
    await act(async () => { streams[1]!.emit("meta"); streams[1]!.emit("delta", "¿Un libro de fotografía o de otra cosa?"); streams[1]!.emit("done"); streams[1]!.close(); });
    expect(screen.getByText("¿Un libro de fotografía o de otra cosa?")).toBeInTheDocument();
    expect(document.querySelector('[data-status="completed"]')).toBeInTheDocument();
  });

  it("does not restart while merely typing and does not expose a stop control", async () => {
    mount(); send("Hola.");
    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Otra idea" } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); });
    expect(requests).toHaveLength(1);
    expect(streams[0]!.cancel).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "停止回复" })).not.toBeInTheDocument();
  });

  it("retains the complete batch for a manual retry after a failed stream", async () => {
    mount(); send("Primero"); send("Segundo");
    await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => { streams[0]!.close(); });
    fireEvent.click(await screen.findByRole("button", { name: "重新发送" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.clientMessageId).toBe(requests[0]?.clientMessageId);
    expect(requests[1]?.pendingMessages).toEqual(requests[0]?.pendingMessages);
    expect(requests[1]?.generationId).not.toBe(requests[0]?.generationId);
  });

  it("preserves longer visible text when focus revalidates a shorter saved prefix", async () => {
    mount(); send("Hola"); await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => { streams[0]!.emit("meta"); streams[0]!.emit("delta", "Uno."); streams[0]!.emit("delta", "\n\nDos."); });
    history = [{ id: `a-${requests[0]!.generationId}`, role: "character", generationId: requests[0]!.generationId, text: "Uno.", complete: false }];
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(screen.getByText("Dos.")).toBeInTheDocument();
  });

  it("cancels a response that arrives after supersession without its done or finally touching the new request", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    let resolveOld: ((response: Response) => void) | undefined;
    let oldRequest: Request | undefined;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (String(input).endsWith("/stream") && !oldRequest) {
        oldRequest = JSON.parse(String(init?.body)) as Request;
        return new Promise<Response>((resolve) => { resolveOld = resolve; });
      }
      return original(input, init);
    });
    mount(); send("Primero"); await waitFor(() => expect(oldRequest).toBeDefined());
    send("Segundo"); await waitFor(() => expect(streams).toHaveLength(1));
    expect(requests[0]?.supersedes).toEqual({ generationId: oldRequest!.generationId, visibleBubbleCount: 0 });
    const cancelOldBody = vi.fn();
    await act(async () => {
      resolveOld!(new Response(new ReadableStream({ cancel: cancelOldBody })));
    });
    expect(cancelOldBody).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-status="streaming"]')).toBeInTheDocument();
    send("Tercero"); await waitFor(() => expect(requests).toHaveLength(2));
    expect(streams[0]!.cancel).toHaveBeenCalled();
    expect(requests[1]?.pendingMessages?.map((message) => message.text)).toEqual(["Primero", "Segundo"]);
    await act(async () => { streams[1]!.emit("meta"); streams[1]!.emit("delta", "Recibido."); streams[1]!.emit("done"); streams[1]!.close(); });
    expect(document.querySelector('[data-status="completed"]')).toBeInTheDocument();
  });

  it("counts only visible complete paragraphs when restarting a partially delivered turn", async () => {
    mount(); send("Cuéntame."); await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => { streams[0]!.emit("meta"); streams[0]!.emit("delta", "Uno.\nSigue aquí."); streams[0]!.emit("delta", "\n\nDos."); });
    send("Espera."); await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.supersedes?.visibleBubbleCount).toBe(2);
    expect(screen.getByText("Dos.")).toBeInTheDocument();
  });

  it("keeps the twenty-first draft and every already submitted client id instead of silently dropping messages", async () => {
    mount();
    for (let i = 1; i <= 21; i += 1) send(`Mensaje ${i}`);
    expect(screen.getByRole("textbox")).toHaveValue("Mensaje 21");
    expect(screen.getByText(/待回复的消息较多/)).toBeInTheDocument();
    expect(document.querySelectorAll(".conversation-message--user")).toHaveLength(20);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.pendingMessages).toHaveLength(19);
    expect(requests[0]?.text).toBe("Mensaje 20");
  });

  it("keeps queued drafts without exposing a stop control", async () => {
    mount(); send("Uno"); send("Dos");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "停止回复" })).not.toBeInTheDocument();
    expect(document.querySelectorAll(".conversation-message--user")).toHaveLength(2);
  });

  it("cleans up the reader when permissions are revoked and does not restart pending work", async () => {
    mount(); send("Hola"); await waitFor(() => expect(streams).toHaveLength(1));
    canSend = false;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(streams[0]!.cancel).toHaveBeenCalled());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  it("cancels transport and removes old-character content on a character switch", async () => {
    const view = mount(); send("Hola"); await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => { streams[0]!.emit("meta"); streams[0]!.emit("delta", "Respuesta de Lucía."); });
    view.rerender(<ChatThread characterKey="mateo" characterName="Mateo Ruiz" characterVersion={1} initialMessages={[]} />);
    await waitFor(() => expect(streams[0]!.cancel).toHaveBeenCalled());
    expect(screen.queryByText("Respuesta de Lucía.")).not.toBeInTheDocument();
  });

  it("restores visible interrupted bubbles from the account-scoped cache when remounted", async () => {
    const view = mount(); send("Hola"); await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => { streams[0]!.emit("meta"); streams[0]!.emit("delta", "Uno."); streams[0]!.emit("delta", "\n\nDos."); });
    view.unmount();
    history = [{ id: `a-${requests[0]!.generationId}`, role: "character", generationId: requests[0]!.generationId, text: "Uno.", complete: true, status: "cancelled" }];
    mount();
    expect(await screen.findByText("Dos.")).toBeInTheDocument();
  });
});
