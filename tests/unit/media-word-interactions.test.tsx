import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeWordAt, validWordTimings } from "@/src/modules/media/domain/word-timeline";
import { SegmentTranscript } from "@/src/modules/media/ui/segment-transcript";
import { LexicalDrawer } from "@/src/modules/media/ui/lexical-drawer";
import { requestWordExplanation } from "@/src/modules/media/ui/request-word-explanation";

const words = [
  { startMs: 100, endMs: 400, startOffset: 0, endOffset: 4 },
  { startMs: 500, endMs: 900, startOffset: 6, endOffset: 10 },
];
const segment = { id: "s", index: 0, startMs: 0, endMs: 1000, sourceText: "Hola, hola.", translation: null, speaker: null, words };
const explanation = { partOfSpeech: "感叹词", meaning: "你好", contextualMeaning: "用于打招呼", example: "¡Hola, Ana!" };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("real word timing", () => {
  it("always follows the current word on mobile without jumping on mount", () => {
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const props = { segments: [segment], activeIndex: 0, captionMode: "es" as const, mediaKind: "podcast" as const, onSeek: vi.fn(), onWord: vi.fn() };
    const { rerender } = render(<SegmentTranscript {...props} positionMs={200} />);
    const rect = { top: 1200, bottom: 1230, height: 30, left: 0, right: 100, width: 100, x: 0, y: 1200, toJSON: () => ({}) };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    expect(scroll).not.toHaveBeenCalled();
    rerender(<SegmentTranscript {...props} positionMs={600} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    fireEvent.touchMove(window);
    rerender(<SegmentTranscript {...props} positionMs={650} />);
    expect(scroll).toHaveBeenCalledTimes(2);
    const focusedWord = screen.getByRole("button", { name: "查看词语 Hola" });
    vi.spyOn(focusedWord, "matches").mockReturnValue(true);
    fireEvent.focusIn(focusedWord);
    rerender(<SegmentTranscript {...props} positionMs={700} />);
    expect(scroll).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("button", { name: "回到当前句" })).not.toBeInTheDocument();
  });

  it("keeps scrolling the transcript panel after manual browsing", () => {
    const props = { segments: [segment], activeIndex: 0, captionMode: "es" as const, mediaKind: "video" as const, onSeek: vi.fn(), onWord: vi.fn() };
    const { rerender } = render(<SegmentTranscript {...props} positionMs={200} />);
    const list = screen.getByRole("list");
    const currentWord = screen.getByRole("button", { name: "查看词语 Hola" });
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 200, height: 200, left: 0, right: 300, width: 300, x: 0, y: 0, toJSON: () => ({}) });
    vi.spyOn(currentWord, "getBoundingClientRect").mockReturnValue({ top: 300, bottom: 330, height: 30, left: 0, right: 100, width: 100, x: 0, y: 300, toJSON: () => ({}) });
    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    rerender(<SegmentTranscript {...props} positionMs={250} />);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    fireEvent.wheel(list);
    rerender(<SegmentTranscript {...props} positionMs={300} />);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "回到当前句" })).not.toBeInTheDocument();
  });

  it("moves the sentence highlight and clears it in gaps without word timings", () => {
    const segments = [{ ...segment, words: undefined, translation: "你好。" }, { ...segment, id: "s2", index: 1, startMs: 1200, endMs: 2200, words: undefined }];
    const props = { segments, captionMode: "bilingual" as const, mediaKind: "video" as const, onSeek: vi.fn(), onWord: vi.fn() };
    const { rerender } = render(<SegmentTranscript {...props} activeIndex={0} positionMs={200} />);
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("你好。")).toHaveAttribute("lang", "zh-CN");
    rerender(<SegmentTranscript {...props} activeIndex={1} positionMs={1300} />);
    expect(screen.getAllByRole("listitem")[0]).not.toHaveClass("is-active");
    expect(screen.getAllByRole("listitem")[1]).toHaveClass("is-active");
    rerender(<SegmentTranscript {...props} activeIndex={null} positionMs={1100} />);
    expect(document.querySelector(".is-active")).toBeNull();
    expect(document.querySelector(".is-speaking")).toBeNull();
  });
  it("reports missing bilingual data rather than silently pretending the mode works", () => {
    render(<SegmentTranscript segments={[segment]} activeIndex={0} captionMode="bilingual" mediaKind="podcast" onSeek={vi.fn()} onWord={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("尚无已审核中文译文");
  });
  it("does not expose raw transcription speaker identifiers", () => {
    render(<SegmentTranscript segments={[{ ...segment, speaker: "S1" }]} activeIndex={0} captionMode="es" mediaKind="video" onSeek={vi.fn()} onWord={vi.fn()} />);
    expect(screen.queryByText("S1", { exact: true })).not.toBeInTheDocument();
  });
  it("handles gaps, exact boundaries and repeated words without inventing timings", () => {
    expect(validWordTimings(segment)).toEqual(words);
    expect(activeWordAt(words, 100)).toEqual(words[0]);
    expect(activeWordAt(words, 400)).toBeNull();
    expect(activeWordAt(words, 500)).toEqual(words[1]);
    expect(activeWordAt(words, 900)).toBeNull();
    expect(validWordTimings({ ...segment, words: undefined })).toEqual([]);
    expect(validWordTimings({ ...segment, words: [null] as never })).toEqual([]);
    expect(validWordTimings({ ...segment, words: [words[1], words[0]] })).toEqual([]);
    expect(validWordTimings({ ...segment, words: [{ ...words[0], endOffset: 100 }] })).toEqual([]);
  });

  it("moves the speaking box by offset while keeping automatic following enabled", () => {
    const props = { segments: [segment], activeIndex: 0, captionMode: "es" as const, mediaKind: "video" as const, onSeek: vi.fn(), onWord: vi.fn() };
    const { rerender } = render(<SegmentTranscript {...props} positionMs={200} />);
    expect(screen.getByRole("button", { name: "查看词语 Hola" })).toHaveClass("is-speaking");
    rerender(<SegmentTranscript {...props} positionMs={600} />);
    expect(screen.getByRole("button", { name: "查看词语 Hola" })).not.toHaveClass("is-speaking");
    expect(screen.getByRole("button", { name: "查看词语 hola" })).toHaveClass("is-speaking");
    fireEvent.wheel(screen.getByRole("list"));
    expect(screen.queryByRole("button", { name: "回到当前句" })).toBeNull();
    rerender(<SegmentTranscript {...props} positionMs={950} />);
    expect(document.querySelector(".is-speaking")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看词语 hola" }));
    expect(props.onWord).toHaveBeenCalledWith("hola", segment.sourceText, expect.any(HTMLButtonElement));
  });
});

describe("MiniMax contextual explanation client", () => {
  it("uses the existing authenticated contextual API and accepts a complete JSON result", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: explanation })));
    vi.stubGlobal("fetch", fetch);
    expect(await requestWordExplanation("Hola", segment.sourceText, new AbortController().signal)).toEqual(explanation);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ word: "Hola", context: segment.sourceText, locale: "es-ES", selectionType: "word" });
  });

  it.each([false, true])("requires done in streaming responses (complete=%s)", async (complete) => {
    const body = JSON.stringify({ type: "delta", text: "partial" }) + "\n" + (complete ? JSON.stringify({ type: "done", explanation }) : "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "application/x-ndjson" } })));
    const promise = requestWordExplanation("Hola", segment.sourceText, new AbortController().signal);
    if (complete) expect(await promise).toEqual(explanation);
    else await expect(promise).rejects.toThrow("连接中断");
  });

  it("shows a retry after failure and then displays the explanation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ data: explanation }))));
    render(<LexicalDrawer word="Hola" sentence={segment.sourceText} onClose={vi.fn()} />);
    expect(screen.getByText("AI 语境解析 · 仅供理解参考")).toBeVisible();
    expect(screen.queryByText(/MiniMax AI 语境解析/u)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "重试解析" }));
    expect(await screen.findByText(explanation.contextualMeaning)).toBeVisible();
  });

  it("aborts the previous selection and never displays a late response", async () => {
    let resolveFirst!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...explanation, meaning: "再见" } })));
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<LexicalDrawer word="Hola" sentence="Hola." onClose={vi.fn()} />);
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    rerender(<LexicalDrawer word="Adiós" sentence="Adiós." onClose={vi.fn()} />);
    expect(signal.aborted).toBe(true);
    expect(await screen.findByText("再见")).toBeVisible();
    resolveFirst(new Response(JSON.stringify({ data: explanation })));
    await waitFor(() => expect(screen.queryByText("你好")).toBeNull());
  });
});
