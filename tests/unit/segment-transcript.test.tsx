import { cleanup, render, screen } from "@testing-library/react";
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
