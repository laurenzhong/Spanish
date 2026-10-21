import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LexicalDrawer } from "@/src/modules/media/ui/lexical-drawer";

const speech = vi.hoisted(() => ({ speak: vi.fn(), stop: vi.fn(), clearError: vi.fn() }));
vi.mock("@/src/modules/providers/tts/use-read-aloud", () => ({
  useReadAloud: () => ({ ...speech, speakingId: null, errorMessage: "" }),
}));

const dictionary = (word = "café") => ({ data: {
  found: true, word, markKey: word, meanings: [{ meaning: "咖啡", usage: "" }],
  meaningSource: "language-reactor", partOfSpeech: "名词", cefr: "A1",
  usageNotes: ["饮品或咖啡馆。"], collocations: ["un café con leche"], examples: [], forms: [],
} });
const explanation = { partOfSpeech: "名词", meaning: "咖啡", contextualMeaning: "这里指一杯咖啡。", example: "Quiero un café." };
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url) => Promise.resolve(response(
    String(url).endsWith("word-explanation") ? { data: explanation } : dictionary(),
  ))));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("media subtitle word panel", () => {
  it("loads the same dictionary as the shelf, retains the actual subtitle and offers a surface corpus query", async () => {
    render(<LexicalDrawer word="café" sentence="Quería un café con leche." onClose={vi.fn()} />);
    expect(await screen.findByText("饮品或咖啡馆。")).toBeVisible();
    expect(screen.getByText("Quería un café con leche.")).toBeVisible();
    expect(screen.getByText("un café con leche")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看语料用法" })).toHaveAttribute("href", "/read/corpus?q=caf%C3%A9&match=surface");
    expect(fetch).toHaveBeenCalledWith("/api/v1/read/word-lookup", expect.objectContaining({ body: JSON.stringify({ word: "café" }), signal: expect.any(AbortSignal) }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/将在词句语料阶段接入/)).not.toBeInTheDocument();
  });

  it("uses reviewed forms immediately and keeps this fallback when the dictionary fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    render(<LexicalDrawer word="quería" sentence="Quería un café." onClose={vi.fn()} />);
    expect(screen.getByText("querer", { exact: true })).toBeVisible();
    expect(await screen.findByRole("button", { name: "重试查词" })).toBeVisible();
    expect(screen.getByText("Quería un café.")).toBeVisible();
  });

  it("distinguishes a missing entry from service failure and can retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ data: { found: false, word: "desconocidísimo" } }));
    const user = userEvent.setup();
    render(<LexicalDrawer word="desconocidísimo" sentence="Es desconocidísimo." onClose={vi.fn()} />);
    expect(await screen.findByText("这里指一杯咖啡。")).toBeVisible();
    expect(screen.queryByText(/暂未收录这个词/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试查词" })).not.toBeInTheDocument();
    cleanup();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 503 }));
    render(<LexicalDrawer word="café" sentence="Un café." onClose={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "重试查词" }));
    expect(await screen.findByText("饮品或咖啡馆。")).toBeVisible();
  });

  it("rejects malformed dictionary results without replacing the reviewed meaning", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ data: { found: true, meanings: [{ meaning: 123 }] } }));
    render(<LexicalDrawer word="café" sentence="Un café." onClose={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "重试查词" })).toBeVisible();
    expect(screen.queryByText("123")).not.toBeInTheDocument();
  });

  it("automatically explains the clicked word in its actual sentence without extra prompts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(dictionary())).mockResolvedValueOnce(response({ data: explanation }));
    render(<LexicalDrawer word="café" sentence="Quería un café con leche." onClose={vi.fn()} />);
    await screen.findByText("饮品或咖啡馆。");
    expect(await screen.findByText("这里指一杯咖啡。")).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "朗读单词" })).toBeVisible();
    expect(screen.getByText("Quería un café con leche.")).toBeVisible();
    expect(screen.queryByText("单词朗读 · 合成音")).not.toBeInTheDocument();
    expect(screen.queryByText(/按需生成/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "解释这句中的用法" })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/read/word-explanation", expect.objectContaining({
      body: JSON.stringify({ word: "café", context: "Quería un café con leche.", locale: "es-ES", selectionType: "word" }),
    }));
  });

  it("isolates late dictionary responses when switching words and cancels both old requests", async () => {
    let resolveOld!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const view = render(<LexicalDrawer word="café" sentence="Un café." onClose={vi.fn()} />);
    const oldSignal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    view.rerender(<LexicalDrawer word="pan" sentence="Un pan." onClose={vi.fn()} />);
    expect(oldSignal.aborted).toBe(true);
    await screen.findByText("饮品或咖啡馆。");
    await act(async () => { resolveOld(response({ data: { ...dictionary().data, usageNotes: ["STALE"] } })); });
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
    expect(screen.getByText("Un pan.")).toBeVisible();
  });

  it("does not let an old contextual explanation replace the newly selected word", async () => {
    let resolveOld!: (value: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(response(dictionary()))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(response(dictionary("pan")))
      .mockResolvedValueOnce(response({ data: { ...explanation, contextualMeaning: "这里指面包。" } }));
    const view = render(<LexicalDrawer word="café" sentence="Un café." onClose={vi.fn()} />);
    await screen.findByText("饮品或咖啡馆。");
    const oldSignal = vi.mocked(fetch).mock.calls[1][1]!.signal!;
    view.rerender(<LexicalDrawer word="pan" sentence="Un pan." onClose={vi.fn()} />);
    expect(oldSignal.aborted).toBe(true);
    await screen.findByText("这里指面包。");
    await act(async () => { resolveOld(response({ data: explanation })); });
    expect(screen.queryByText("这里指一杯咖啡。")).not.toBeInTheDocument();
    expect(screen.getByText("Un pan.")).toBeVisible();
  });

  it("offers retry after an explanation stream ends without done", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(dictionary()))
      .mockResolvedValueOnce(new Response('{"type":"delta","text":"preview"}\n', { headers: { "content-type": "application/x-ndjson" } }))
      .mockResolvedValueOnce(response({ data: explanation }));
    const user = userEvent.setup();
    render(<LexicalDrawer word="café" sentence="Un café." onClose={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "重试语境解释" }));
    expect(await screen.findByText("这里指一杯咖啡。")).toBeVisible();
    expect(screen.queryByText("preview")).not.toBeInTheDocument();
  });

  it("does not wait for the dictionary or repeat generation on an unchanged selection", async () => {
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    const props = { word: "golpiza", sentence: "Producto de esa violación y de esa golpiza, una de tantas, yo perdí al niño.", onClose: vi.fn() };
    const view = render(<LexicalDrawer {...props} />);
    expect(await screen.findByText("这里指一杯咖啡。")).toBeVisible();
    view.rerender(<LexicalDrawer {...props} />);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/read/word-explanation", expect.objectContaining({
      body: JSON.stringify({ word: props.word, context: props.sentence, locale: "es-ES", selectionType: "word" }),
    }));
    view.unmount();
    for (const [, options] of vi.mocked(fetch).mock.calls) expect(options!.signal!.aborted).toBe(true);
  });

  it("does not send a duplicate explanation during StrictMode effect replay", async () => {
    render(<StrictMode><LexicalDrawer word="café" sentence="Un café." onClose={vi.fn()} /></StrictMode>);
    await screen.findByText("这里指一杯咖啡。");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("word-explanation"))).toHaveLength(1);
  });

  it("starts a fresh explanation when the same word occurs in a different sentence", async () => {
    const view = render(<LexicalDrawer word="café" sentence="Un café." onClose={vi.fn()} />);
    await screen.findByText("这里指一杯咖啡。");
    view.rerender(<LexicalDrawer word="café" sentence="El café está cerrado." onClose={vi.fn()} />);
    await screen.findByText("这里指一杯咖啡。");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/read/word-explanation", expect.objectContaining({
      body: JSON.stringify({ word: "café", context: "El café está cerrado.", locale: "es-ES", selectionType: "word" }),
    }));
  });

  it("bounds a hanging contextual explanation to 30 seconds and aborts it", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    render(<LexicalDrawer word="café" sentence="Un café." onClose={vi.fn()} />);
    expect(screen.getByText("正在生成解析…")).toBeVisible();
    await act(async () => {});
    const currentSignal = vi.mocked(fetch).mock.calls.at(-1)![1]!.signal!;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(currentSignal.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "重试语境解释" })).toBeVisible();
  });

  it("shows preparing until speech start, speaks only the selected surface word, and can stop", async () => {
    const user = userEvent.setup();
    const pause = vi.fn();
    render(<LexicalDrawer word="café" sentence="Un café con leche." onClose={vi.fn()} onBeforeRead={pause} />);
    await user.click(screen.getByRole("button", { name: "朗读单词" }));
    expect(screen.getByText(/正在准备合成音/)).toBeVisible();
    expect(speech.speak).toHaveBeenCalledWith("media-word", "café", expect.any(Function), expect.any(Object));
    expect(pause).toHaveBeenCalledTimes(1);
    const callbacks = speech.speak.mock.calls[0][3];
    act(() => callbacks.onStart());
    expect(screen.getByText(/正在朗读.*合成音/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "停止朗读" }));
    expect(speech.stop).toHaveBeenCalled();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "朗读单词" })).toBeVisible();
  });

  it("supports Escape from within the panel and stops speech on hide and unmount", async () => {
    const onClose = vi.fn();
    const view = render(<LexicalDrawer word="café" sentence="Un café." onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "关闭词句上下文" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent(document, new Event("visibilitychange"));
    view.unmount();
    expect(vi.mocked(fetch).mock.calls[0][1]!.signal!.aborted).toBe(true);
  });

  it("announces automatic results without moving keyboard focus and keeps Escape available", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(dictionary())).mockResolvedValueOnce(response({ data: explanation }));
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LexicalDrawer word="café" sentence="Un café." onClose={onClose} />);
    await screen.findByText("这里指一杯咖啡。");
    expect(screen.getByRole("button", { name: "关闭词句上下文" })).toHaveFocus();
    expect(screen.getByLabelText("AI 语境解释")).toHaveAttribute("aria-live", "polite");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ends a hanging dictionary request after 20 seconds with a retry path", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    render(<LexicalDrawer word="café" sentence="Un café." onClose={vi.fn()} />);
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(screen.getByRole("button", { name: "重试查词" })).toBeVisible();
  });
});
