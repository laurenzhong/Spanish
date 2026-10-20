import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentTranscript } from "@/src/modules/media/ui/segment-transcript";

const segments = Array.from({ length: 160 }, (_, index) => ({
  id: `cue-${index}`, index: index * 2, startMs: index * 1_000, endMs: (index + 1) * 1_000,
  sourceText: `Hola ${index}`, translation: `字幕 ${index}`, speaker: null, words: null,
}));
const input = { segments, activeIndex: 0, captionMode: "es" as const, currentPositionMs: 0, mediaKind: "video" as const, follow: false, onSeek: vi.fn(), onWord: vi.fn() };

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("incremental transcript mounting", () => {
  it("bounds server-rendered word controls while showing the real current cue near the tail", () => {
    const markup = renderToStaticMarkup(<SegmentTranscript {...input} activeIndex={318} />);
    expect((markup.match(/class="segment-transcript__time"/gu) ?? []).length).toBeLessThan(40);
    expect(markup).toContain('id="segment-318"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain('id="segment-160"');
  });

  it("mounts every cue in order without truncating the transcript", () => {
    vi.useFakeTimers();
    const { container } = render(<SegmentTranscript {...input} />);
    expect(container.querySelectorAll(".segment-transcript__time").length).toBeLessThan(40);
    for (let i = 0; i < 10; i++) act(() => vi.advanceTimersByTime(40));
    expect(Array.from(container.querySelectorAll("li[id]"), (row) => row.id)).toEqual(segments.map(segment => `segment-${segment.index}`));
    expect(screen.queryByText("其余字幕正在加载…")).not.toBeInTheDocument();
    expect(container.querySelector("ol")).toHaveAttribute("aria-busy", "false");
  });

  it("shows a distant newly selected cue before the remaining batches mount", () => {
    vi.useFakeTimers();
    const view = render(<SegmentTranscript {...input} />);
    view.rerender(<SegmentTranscript {...input} activeIndex={318} />);
    expect(view.container.querySelector("#segment-318")).toHaveClass("is-active");
    expect(view.container.querySelectorAll("#segment-318")).toHaveLength(1);
    expect(view.container.querySelectorAll(".segment-transcript__time").length).toBeLessThan(40);
  });

  it("cancels pending mounting on hiding, switching versions and unmount", () => {
    vi.useFakeTimers();
    const view = render(<SegmentTranscript {...input} />);
    expect(vi.getTimerCount()).toBe(1);
    view.rerender(<SegmentTranscript {...input} captionMode="hidden" />);
    expect(vi.getTimerCount()).toBe(0);
    view.rerender(<SegmentTranscript {...input} segments={segments.slice(0, 2).map(segment => ({ ...segment, id: `new-${segment.id}` }))} />);
    expect(view.container.querySelectorAll("li[id]")).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1_000));
    expect(view.container.querySelectorAll("li[id]")).toHaveLength(2);
    view.rerender(<SegmentTranscript {...input} />);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
