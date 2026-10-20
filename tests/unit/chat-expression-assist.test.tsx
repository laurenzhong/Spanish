import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { clearConversationHistoryCache } from "@/src/modules/conversation/ui/conversation-history-cache";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const spanish = "Hoy estoy cansado. ¿Quedamos otro día?";
const sent: Array<Record<string, unknown>> = [];
let streamResult: (body: Record<string, unknown>) => Promise<Response>;

function completed(body: Record<string, unknown>) {
  const generationId = body.generationId;
  return new Response([
    { type: "meta", protocolVersion: "v1", characterKey: "lucia", characterVersion: 1, generationId, messageId: `reply-${generationId}` },
    { type: "delta", generationId, messageId: `reply-${generationId}`, text: "Vale, hablamos luego." },
    { type: "done", generationId, messageId: `reply-${generationId}` },
  ].map((frame) => JSON.stringify(frame)).join("\n") + "\n", {
    headers: { "content-type": "application/x-ndjson", "x-conversation-persistence": "available" },
  });
}

beforeEach(() => {
  sent.length = 0;
  streamResult = async (body) => completed(body);
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, options?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/expression-assist")) {
      const request = JSON.parse(String(options?.body));
      return Response.json({ apiVersion: "v1", data: { text: spanish, attemptId: request.attemptId } });
    }
    if (url.endsWith("/stream")) {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      sent.push(body);
      return streamResult(body);
    }
    if (url === "/api/v1/conversations/lucia") return Response.json({ data: { characterKey: "lucia", messages: [], canSend: true, readOnly: false, contactStatus: "active" } }, { headers: { "x-conversation-persistence": "available" } });
    if (url === "/api/v1/conversations") return Response.json({ data: { conversations: [] } });
    return Response.json({}, { status: 404 });
  }));
});
afterEach(() => { cleanup(); clearConversationHistoryCache(); vi.unstubAllGlobals(); });

function mount() {
  return render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} initialMessages={[]} />);
}
async function preview() {
  fireEvent.change(composer(), { target: { value: "我今天累了，改天约" } });
  await userEvent.click(screen.getByRole("button", { name: "译成西语" }));
  await screen.findByText(spanish);
}
const composer = () => screen.getByRole("textbox", { name: "写下你想对 Lucía 说的话" });

describe("expression assistance in the actual chat thread", () => {
  it("fills an editable draft and preserves provenance without labeling the composer or sent message", async () => {
    mount();
    await preview();
    expect(screen.queryByText("本轮已用翻译辅助")).not.toBeInTheDocument();
    expect(sent).toEqual([]);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(composer()).toHaveValue("我今天累了，改天约");
    await userEvent.click(screen.getByRole("button", { name: "使用译文" }));
    expect(composer()).toHaveValue(spanish);
    expect(composer()).toHaveFocus();
    expect(sent).toEqual([]);
    fireEvent.change(composer(), { target: { value: `${spanish} Gracias.` } });
    await userEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ text: `${spanish} Gracias.`, assistance: "translation" });
    expect(JSON.stringify(sent)).not.toContain("我今天");
    await waitFor(() => expect(screen.getByTestId("conversation-thread")).toHaveAttribute("data-status", "completed"));
    expect(screen.queryByText("翻译辅助")).not.toBeInTheDocument();
    fireEvent.change(composer(), { target: { value: "Hasta luego." } });
    await userEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).not.toHaveProperty("assistance");
  });

  it("retains assistance after closing and manually composing a spoken-style reply", async () => {
    mount();
    await preview();
    await userEvent.click(screen.getByRole("button", { name: "关闭翻译预览" }));
    fireEvent.change(composer(), { target: { value: "¿Quedamos mañana?" } });
    await userEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toHaveProperty("assistance", "translation");
  });

  it("keeps the assistance on a retry of the same failed message", async () => {
    streamResult = async () => Response.json({}, { status: 503 });
    mount();
    await preview();
    await userEvent.click(screen.getByRole("button", { name: "使用译文" }));
    await userEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await screen.findByRole("button", { name: "重新发送" });
    streamResult = async (body) => completed(body);
    await userEvent.click(screen.getByRole("button", { name: "重新发送" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ clientMessageId: sent[0]?.clientMessageId, assistance: "translation" });
    expect(document.querySelectorAll(".conversation-message--user")).toHaveLength(1);
  });

  it("keeps queued assistance attached to its own turn", async () => {
    let release!: () => void;
    streamResult = (body) => new Promise((resolve) => { release = () => resolve(completed(body)); });
    mount();
    fireEvent.change(composer(), { target: { value: "Hola." } });
    await userEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await preview();
    await userEvent.click(screen.getByRole("button", { name: "使用译文" }));
    await userEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(sent).toHaveLength(1);
    streamResult = async (body) => completed(body);
    await act(async () => release());
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0]).not.toHaveProperty("assistance");
    expect(sent[1]).toMatchObject({ text: spanish, assistance: "translation" });
  });
});
