import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const speechMock = vi.hoisted(() => ({
  levels: [] as Array<(level: number) => void>,
  initialize: vi.fn<(interrupt?: () => void) => void>(),
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
  return { ...original, createBrowserAudioRecorder: (interrupt?: () => void) => {
    speechMock.initialize(interrupt);
    return speechMock.recorder;
  } };
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
    speechMock.recorder.stop.mockClear();
    speechMock.initialize.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps a Safari IME confirmation from sending the draft", () => {
    const onSubmit = vi.fn();
    render(<VoiceComposer onCancel={vi.fn()} onChange={vi.fn()} onSubmit={onSubmit} value="Hola" />);
    const field = screen.getByRole("textbox");
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229, isComposing: false });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter", keyCode: 13 });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("recovers after a recorder interruption without transcribing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<VoiceComposer onCancel={vi.fn()} onChange={vi.fn()} onSubmit={vi.fn()} value="" />);
    await userEvent.click(screen.getByRole("button", { name: "使用语音输入" }));
    await screen.findByRole("button", { name: "取消录音" });
    const interrupt = speechMock.initialize.mock.lastCall?.[0];
    expect(interrupt).toBeTypeOf("function");
    act(() => interrupt?.());
    expect(screen.getByRole("textbox")).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("录音已中断");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uploads Safari MP4 audio with a matching filename and confirms the text before sending", async () => {
    speechMock.recorder.stop.mockResolvedValueOnce({
      blob: new Blob(["audio"], { type: "audio/mp4" }),
      metadata: { mimeType: "audio/mp4", sizeBytes: 5 },
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: { text: "Hola" } }));
    vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<VoiceComposer onCancel={vi.fn()} onChange={onChange} onSubmit={onSubmit} value="" />);
    await userEvent.click(screen.getByRole("button", { name: "使用语音输入" }));
    await userEvent.click(await screen.findByRole("button", { name: "结束录音" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("Hola"));
    const audio = (fetch.mock.calls[0]?.[1]?.body as FormData).get("audio") as File;
    expect(audio.name).toBe("conversation.m4a");
    expect(audio.type).toBe("audio/mp4");
    expect(onSubmit).not.toHaveBeenCalled();
  });

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
