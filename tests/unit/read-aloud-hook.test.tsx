import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  isSupported: true,
  speak: vi.fn<(text: string, options: { languageTag: string; rate?: number; onStart?: () => void }) => Promise<void>>(),
  stop: vi.fn(),
}));
vi.mock("@/src/modules/providers/tts/read-aloud", () => ({
  createReadAloud: () => fake,
  readAloudErrorMessage: () => "朗读失败",
}));
import { useReadAloud } from "@/src/modules/providers/tts/use-read-aloud";
import { useBrowserSpeech } from "@/src/modules/providers/tts/use-browser-speech";

afterEach(() => { cleanup(); vi.clearAllMocks(); fake.isSupported = true; });

describe("shared read-aloud hook", () => {
  it("keeps the legacy hook as the same implementation", () => {
    expect(useBrowserSpeech).toBe(useReadAloud);
  });

  it("ignores stale start, end and errors after changing entries", async () => {
    let endFirst!: () => void;
    let endSecond!: () => void;
    fake.speak.mockImplementationOnce(() => new Promise((r) => { endFirst = r; }))
      .mockImplementationOnce(() => new Promise((r) => { endSecond = r; }));
    const first = { onStart: vi.fn(), onEnd: vi.fn() };
    const second = { onStart: vi.fn(), onEnd: vi.fn() };
    const { result } = renderHook(() => useReadAloud());
    act(() => result.current.speak("one", "Uno", undefined, first));
    act(() => result.current.speak("two", "Dos", undefined, second));
    act(() => fake.speak.mock.calls[0]![1].onStart?.());
    await act(async () => { endFirst(); });
    expect(first.onStart).not.toHaveBeenCalled();
    expect(first.onEnd).not.toHaveBeenCalled();
    expect(result.current.speakingId).toBe("two");
    act(() => fake.speak.mock.calls[1]![1].onStart?.());
    expect(second.onStart).toHaveBeenCalledOnce();
    await act(async () => { endSecond(); });
    expect(second.onEnd).toHaveBeenCalledOnce();
    expect(result.current.speakingId).toBeNull();
    expect(fake.speak.mock.calls[1]![1]).toMatchObject({ languageTag: "es-ES", rate: 1 });
  });

  it("does not report cancellation as success or failure", async () => {
    fake.speak.mockRejectedValueOnce({ code: "tts-cancelled" });
    const callbacks = { onEnd: vi.fn(), onError: vi.fn() };
    const { result } = renderHook(() => useReadAloud());
    act(() => result.current.speak("one", "Uno", undefined, callbacks));
    await waitFor(() => expect(result.current.speakingId).toBeNull());
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBe("");
  });

  it("supports retry and local error handling without a second automatic request", async () => {
    fake.speak.mockRejectedValueOnce(new Error("failed"));
    const onError = vi.fn();
    const { result } = renderHook(() => useReadAloud());
    act(() => result.current.speak("one", "Uno", undefined, { onError }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("朗读失败"));
    expect(fake.speak).toHaveBeenCalledTimes(1);
    expect(result.current.errorMessage).toBe("");
  });

  it("stops on unmount and prevents later callbacks", async () => {
    let end!: () => void;
    fake.speak.mockImplementationOnce(() => new Promise((r) => { end = r; }));
    const onEnd = vi.fn();
    const { result, unmount } = renderHook(() => useReadAloud());
    act(() => result.current.speak("one", "Uno", undefined, { onEnd }));
    unmount();
    await act(async () => { end(); });
    expect(fake.stop).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
