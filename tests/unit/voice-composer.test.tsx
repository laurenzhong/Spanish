import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const speechMock = vi.hoisted(() => ({
  levels: [] as Array<(level: number) => void>,
  recorder: {
    cancel: vi.fn(async () => undefined),
    isLevelMeterSupported: false,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => ({ blob: new Blob(), metadata: { mimeType: "audio/webm", sizeBytes: 0 } })),
    subscribeLevel: vi.fn<(listener: (level: number) => void) => () => void>(() => () => undefined),
  },
}));

vi.mock("@/src/modules/providers/speech", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/modules/providers/speech")>();
  return { ...original, createBrowserAudioRecorder: () => speechMock.recorder };
});

import { VoiceComposer } from "@/src/modules/conversation/ui/voice-composer";

function waveform(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".conversation-composer__waveform");
  if (!element) throw new Error("the recording waveform is not rendered");
  return element;
}

describe("VoiceComposer", () => {
  beforeEach(() => {
    speechMock.levels.length = 0;
    speechMock.recorder.isLevelMeterSupported = false;
    speechMock.recorder.subscribeLevel.mockClear();
    speechMock.recorder.start.mockClear();
  });

  afterEach(() => cleanup());

  it("keeps send disabled until text is present", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VoiceComposer onCancel={vi.fn()} onChange={onChange} onSubmit={vi.fn()} value="" />);

    expect(screen.getByRole("textbox")).toHaveAttribute("lang", "es");
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "Hola");
    expect(onChange).toHaveBeenCalled();
  });

  it("shows only the stop control while a reply streams", () => {
    render(<VoiceComposer disabled onCancel={vi.fn()} onChange={vi.fn()} onSubmit={vi.fn()} value="" />);

    // The shipped fix (main 20053f4): the trailing slot renders exactly one
    // control, so the stop action replaces the send control instead of stacking
    // next to it.
    expect(screen.getByRole("button", { name: "停止回复" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "发送消息" })).not.toBeInTheDocument();
  });

  it("becomes honestly unavailable without showing a false stop action", () => {
    render(<VoiceComposer unavailable onCancel={vi.fn()} onChange={vi.fn()} onSubmit={vi.fn()} value="Hola" />);

    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "使用语音输入" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "停止回复" })).not.toBeInTheDocument();
    expect(screen.queryByText("Enter 发送 · Shift + Enter 换行")).not.toBeInTheDocument();
  });

  it("drives the recording bars from the measured input level", async () => {
    const user = userEvent.setup();
    speechMock.recorder.isLevelMeterSupported = true;
    speechMock.recorder.subscribeLevel.mockImplementation((listener: (level: number) => void) => {
      speechMock.levels.push(listener);
      return () => undefined;
    });

    render(<VoiceComposer onCancel={vi.fn()} onChange={vi.fn()} onSubmit={vi.fn()} value="" />);
    await user.click(screen.getByRole("button", { name: "使用语音输入" }));

    await waitFor(() => expect(speechMock.levels).toHaveLength(1));
    // Until the first measurement arrives the bars keep the decorative fallback.
    expect(waveform()).toHaveAttribute("data-live", "false");

    act(() => speechMock.levels[0]?.(0.8));

    expect(waveform()).toHaveAttribute("data-live", "true");
    const bars = waveform().querySelectorAll<HTMLElement>("i");
    expect(bars).toHaveLength(7);
    // The third bar is the loudest weight in the pattern.
    expect(bars[2]?.style.transform).toBe("scaleY(0.800)");
    // Silence collapses the bars instead of showing a fake loop.
    act(() => speechMock.levels[0]?.(0));
    expect(bars[2]?.style.transform).toBe("scaleY(0.050)");
  });

  it("keeps the decorative fallback when the browser cannot measure input", async () => {
    const user = userEvent.setup();
    speechMock.recorder.isLevelMeterSupported = false;

    render(<VoiceComposer onCancel={vi.fn()} onChange={vi.fn()} onSubmit={vi.fn()} value="" />);
    await user.click(screen.getByRole("button", { name: "使用语音输入" }));
    await waitFor(() => expect(speechMock.recorder.start).toHaveBeenCalled());

    expect(speechMock.recorder.subscribeLevel).not.toHaveBeenCalled();
    expect(waveform()).toHaveAttribute("data-live", "false");
    expect(waveform().querySelectorAll<HTMLElement>("i")[2]?.style.transform).toBe("");
  });
});
