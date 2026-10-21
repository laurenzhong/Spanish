import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SegmentTranscript } from "@/src/modules/media/ui/segment-transcript";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const scrollingSegments = Array.from({ length: 20 }, (_, index) => ({
  id: `scroll-${index}`, index, startMs: index * 2_000, endMs: (index + 1) * 2_000,
  sourceText: `Frase ${index}.`, translation: `第 ${index} 句。`, speaker: null,
}));

describe("segment transcript following", () => {
  function setup() {
    const props = {
      segments: scrollingSegments, activeIndex: 0, captionMode: "es" as const,
      currentPositionMs: 0, mediaKind: "video" as const, follow: true,
      onSeek: vi.fn(), onWord: vi.fn(),
    };
    const view = render(<SegmentTranscript {...props} />);
    const list = screen.getByRole("list");
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({ top: 200 } as DOMRect);
    for (const [index, row] of [...list.children].entries()) {
      vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => ({
        top: 200 + index * 60 - list.scrollTop, height: 60,
      }) as DOMRect);
    }
    return { props, view, list };
  }

  it("centers a newly spoken line with room for upcoming subtitles without scrolling the page", () => {
    const { props, view, list } = setup();
    const pageScroll = vi.fn();
    const previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = pageScroll;
    try {
      view.rerender(<SegmentTranscript {...props} activeIndex={5} />);
      expect(list.scrollTop).toBe(180);
      expect(pageScroll).not.toHaveBeenCalled();
      view.rerender(<SegmentTranscript {...props} activeIndex={6} />);
      expect(list.scrollTop).toBe(240);
      // Word ticks within a line must leave manual scrolling alone.
      list.scrollTop = 100;
      view.rerender(<SegmentTranscript {...props} activeIndex={6} currentPositionMs={12_500} />);
      expect(list.scrollTop).toBe(100);
    } finally {
      HTMLElement.prototype.scrollIntoView = previous;
    }
  });

  it("leaves scrolling alone when follow is off and catches up when restored", () => {
    const { props, view, list } = setup();
    view.rerender(<SegmentTranscript {...props} activeIndex={8} follow={false} />);
    expect(list.scrollTop).toBe(0);
    view.rerender(<SegmentTranscript {...props} activeIndex={8} />);
    expect(list.scrollTop).toBe(360);
  });

  it("clamps to transcript boundaries and recenters after changing caption mode", () => {
    const { props, view, list } = setup();
    view.rerender(<SegmentTranscript {...props} activeIndex={19} />);
    expect(list.scrollTop).toBe(900);
    view.rerender(<SegmentTranscript {...props} activeIndex={0} />);
    expect(list.scrollTop).toBe(0);
    view.rerender(<SegmentTranscript {...props} activeIndex={5} />);
    list.scrollTop = 0;
    view.rerender(<SegmentTranscript {...props} activeIndex={5} captionMode="bilingual" />);
    expect(list.scrollTop).toBe(180);
    view.rerender(<SegmentTranscript {...props} activeIndex={5} captionMode="hidden" />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    view.rerender(<SegmentTranscript {...props} activeIndex={5} />);
    expect(screen.getByRole("list").querySelector(".is-active")).toHaveAttribute("id", "segment-5");
  });
});

describe("segment transcript playback highlighting", () => {
  it("highlights and keeps the spoken legacy offset-only word selectable", () => {
    render(<SegmentTranscript
      activeIndex={0}
      captionMode="es"
      currentPositionMs={500}
      follow
      mediaKind="video"
      onSeek={vi.fn()}
      onWord={vi.fn()}
      segments={[{
        id: "segment-0",
        index: 0,
        startMs: 0,
        endMs: 2_000,
        sourceText: "Hola mundo.",
        translation: "你好，世界。",
        speaker: null,
        words: [
          { startMs: 0, endMs: 900, startOffset: 0, endOffset: 4 },
          { startMs: 900, endMs: 2_000, startOffset: 5, endOffset: 10 },
        ],
      }]}
    />);

    const hola = screen.getByRole("button", { name: "查看词语 Hola" });
    expect(hola).toHaveAttribute("data-active-word", "true");
    expect(hola).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "查看词语 mundo" })).not.toHaveAttribute("data-active-word", "true");
  });
});

describe("segment transcript speaker labels", () => {
  function renderWithSpeaker(speaker: string | null) {
    return render(<SegmentTranscript
      activeIndex={0}
      captionMode="es"
      currentPositionMs={0}
      follow
      mediaKind="video"
      onSeek={vi.fn()}
      onWord={vi.fn()}
      segments={[{ id: "segment-0", index: 0, startMs: 0, endMs: 2_000, sourceText: "Buenos días, Peppa.", translation: "早上好，佩奇。", speaker }]}
    />);
  }

  it("does not print machine diarization indexes as subtitle speakers", () => {
    const view = renderWithSpeaker("S2");
    const transcript = view.container.querySelector(".segment-transcript")!;
    expect(transcript).not.toHaveTextContent("S2");
    expect(transcript.querySelector("strong")).toBeNull();
    expect(transcript).toHaveTextContent("Buenos días, Peppa.");
  });

  it("still shows a real speaker name when the transcript carries one", () => {
    const view = renderWithSpeaker("Lucía");
    const transcript = view.container.querySelector(".segment-transcript")!;
    expect(transcript.querySelector("strong")).toHaveTextContent("Lucía");
    expect(transcript).toHaveTextContent("Buenos días, Peppa.");
  });
});

describe("segment transcript progressive states", () => {
  const baseProps = {
    segments: [], activeIndex: null, captionMode: "es" as const,
    currentPositionMs: 0, mediaKind: "video" as const, follow: false,
    onSeek: vi.fn(), onWord: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows a loading status and no empty-transcript claim while the text loads", () => {
    render(<SegmentTranscript {...baseProps} expectedCount={12} state="loading" />);
    expect(screen.getByText("字幕正在加载…")).toBeVisible();
    expect(screen.getByText("共 12 段，播放器已可正常使用。")).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText(/目前没有已审核的逐句/)).not.toBeInTheDocument();
  });

  it("shows a retryable error instead of the empty-transcript text", () => {
    const onRetry = vi.fn();
    render(<SegmentTranscript {...baseProps} errorMessage="媒体内容已更新，请刷新页面后重试。" onRetry={onRetry} state="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("媒体内容已更新，请刷新页面后重试。");
    screen.getByRole("button", { name: "重试加载字幕" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the text with an honest word-highlight hint and a separate word retry", () => {
    const onRetry = vi.fn();
    const view = render(<SegmentTranscript {...baseProps} activeIndex={0} segments={scrollingSegments.slice(0, 2)} state="text_ready" wordsState="loading" />);
    expect(screen.getByText("字幕已加载，逐词高亮准备中…")).toBeVisible();
    expect(screen.getByRole("list")).toBeInTheDocument();

    view.rerender(<SegmentTranscript {...baseProps} activeIndex={0} onRetry={onRetry} segments={scrollingSegments.slice(0, 2)} state="text_ready" wordsMessage="逐词高亮加载超时，可重试。" wordsState="unavailable" />);
    expect(screen.getByText("逐词高亮加载超时，可重试。")).toBeVisible();
    // The transcript text itself never disappears because word timings failed.
    expect(screen.getByRole("list")).toBeInTheDocument();
    screen.getByRole("button", { name: "重试逐词高亮" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("only claims there is no transcript when the ready state really has no cues", () => {
    const view = render(<SegmentTranscript {...baseProps} state="ready" />);
    expect(screen.getByText("这项视频可以播放，但目前没有已审核的逐句字幕。")).toBeVisible();
    view.rerender(<SegmentTranscript {...baseProps} segments={scrollingSegments.slice(0, 2)} state="ready" />);
    expect(screen.queryByText("这项视频可以播放，但目前没有已审核的逐句字幕。")).not.toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("does not reset already mounted rows when word timings are merged into the same cues", () => {
    vi.useFakeTimers();
    const many = Array.from({ length: 80 }, (_, index) => ({
      id: `cue-${index}`, index, startMs: index * 1_000, endMs: (index + 1) * 1_000,
      sourceText: `Hola ${index}.`, translation: null, speaker: null,
    }));
    const props = { ...baseProps, activeIndex: 0, segments: many };
    const view = render(<SegmentTranscript {...props} />);
    for (let step = 0; step < 4; step += 1) act(() => vi.advanceTimersByTime(40));
    expect(view.container.querySelectorAll("li[id]")).toHaveLength(80);
    expect(view.container.querySelector("ol")).toHaveAttribute("aria-busy", "false");

    const withWords = many.map((segment) => ({
      ...segment,
      words: [{ startMs: segment.startMs, endMs: segment.endMs, startOffset: 0, endOffset: 4, text: "Hola" }],
    }));
    view.rerender(<SegmentTranscript {...props} segments={withWords} state="ready" />);
    // Same cues + same batch: every mounted row stays mounted (32-row reset bug).
    expect(view.container.querySelectorAll("li[id]")).toHaveLength(80);
    expect(view.container.querySelector("ol")).toHaveAttribute("aria-busy", "false");
  });
});
