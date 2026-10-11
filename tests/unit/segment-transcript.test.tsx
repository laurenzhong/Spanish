import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SegmentTranscript } from "@/src/modules/media/ui/segment-transcript";

afterEach(cleanup);

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
