import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MediaLearningWorkbench,
  type AudioPlayerFactory,
  type AudioPlayerLifecycle,
  type AudioPlayerPort,
  nativeAudioPlayerFactory,
} from "@/src/modules/media";

function playback(withTranscript = true) {
  return {
    media: {
      id: "podcast.episode42@1", stableKey: "podcast.episode42", version: 1, kind: "podcast" as const,
      title: "Una mañana en el mercado", summary: "Una charla breve.", sourceName: "Café de cada día", language: "es",
      region: "es-ES", cefr: "A2" as const, topics: ["topic.daily-life"], durationMs: 7_000,
      publishedAt: "2026-09-13T08:00:00.000Z", curatedAt: "2026-09-14T10:00:00.000Z", contentHash: "a".repeat(64),
      progress: { lastPositionMs: 0, lastSegmentIndex: withTranscript ? 0 : null, status: "in_progress" as const, revision: 2 },
    },
    asset: { kind: "audio" as const, url: "https://media.example.test/episode-42.mp3", expiresAt: "2026-09-21T10:00:00.000Z" },
    segments: withTranscript ? [
      { id: "s0", index: 0, startMs: 0, endMs: 2_200, sourceText: "Buenos días, ¿qué te pongo?", translation: null, speaker: null },
      { id: "s1", index: 1, startMs: 2_200, endMs: 5_000, sourceText: "Quería medio kilo de naranjas.", translation: null, speaker: null },
      { id: "s2", index: 2, startMs: 5_000, endMs: 7_000, sourceText: "Claro.", translation: null, speaker: null },
    ] : [],
  };
}

function fakePlayer() {
  let lifecycle: AudioPlayerLifecycle | null = null;
  let currentTimeMs = 0;
  const port: AudioPlayerPort = {
    play: vi.fn(), pause: vi.fn(), seek: vi.fn((value) => { currentTimeMs = value; }),
    currentTime: vi.fn(() => currentTimeMs), destroy: vi.fn(),
  };
  const factory: AudioPlayerFactory = vi.fn((_element, input) => { lifecycle = input.lifecycle; return port; });
  return { factory, port, lifecycle: () => lifecycle!, setCurrentTime: (value: number) => { currentTimeMs = value; } };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { progress: { revision: 3 } } }), { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("podcast audio player", () => {
  it("shows the current sentence only in the transcript, including after navigation and hiding captions", () => {
    const player = fakePlayer();
    render(<MediaLearningWorkbench audioPlayerFactory={player.factory} playback={playback()} />);
    act(() => player.lifecycle().onReady());

    expect(screen.queryByRole("group", { name: "当前片段" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "查看词语 Quería" }).closest("li")).toHaveClass("is-active");
    expect(screen.queryByRole("group", { name: "当前片段" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "隐藏" }));
    expect(screen.queryByRole("button", { name: "查看词语 Quería" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "当前片段" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Una mañana en el mercado 播放器")).toBeVisible();
  });

  it("forwards native seek and timeupdate events while removing them on destroy", () => {
    const element = document.createElement("audio");
    const load = vi.spyOn(element, "load").mockImplementation(() => undefined);
    const pause = vi.spyOn(element, "pause").mockImplementation(() => undefined);
    const onPositionChange = vi.fn();
    const lifecycle: AudioPlayerLifecycle = {
      onReady: vi.fn(), onStateChange: vi.fn(), onError: vi.fn(), onPositionChange,
    };
    const port = nativeAudioPlayerFactory(element, { url: "https://media.example.test/episode.mp3", lifecycle });
    element.dispatchEvent(new Event("timeupdate"));
    element.dispatchEvent(new Event("seeking"));
    element.dispatchEvent(new Event("seeked"));
    expect(onPositionChange).toHaveBeenCalledTimes(3);
    port.destroy();
    element.dispatchEvent(new Event("timeupdate"));
    expect(onPositionChange).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
    load.mockRestore();
    pause.mockRestore();
  });

  it("keeps sentence navigation on the arrow keys, plus the transcript drawer and revisioned progress", async () => {
    const player = fakePlayer();
    render(<MediaLearningWorkbench audioPlayerFactory={player.factory} playback={playback()} />);
    act(() => player.lifecycle().onReady());
    expect(screen.getByLabelText("Una mañana en el mercado 播放器")).toBeInTheDocument();

    // The owner navigates sentences with the arrow keys; there is no button row.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(player.port.seek).toHaveBeenLastCalledWith(2_200);
    expect(player.port.play).toHaveBeenCalled();

    const word = screen.getByRole("button", { name: "查看词语 Buenos" });
    await userEvent.setup().click(word);
    await userEvent.setup().click(screen.getByRole("button", { name: "关闭词句上下文" }));
    expect(word).toHaveFocus();

    player.setCurrentTime(3_000);
    act(() => player.lifecycle().onStateChange("paused"));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/v1/media/podcast.episode42/progress",
      expect.objectContaining({ body: expect.stringContaining('"lastPositionMs":3000') }),
    ));
  });

  it("auto-pauses at a reviewed boundary and destroys the audio port on replacement", () => {
    vi.useFakeTimers();
    const first = fakePlayer();
    const view = render(<MediaLearningWorkbench audioPlayerFactory={first.factory} playback={playback()} />);
    act(() => first.lifecycle().onReady());
    fireEvent.keyDown(window, { key: "q" });
    first.setCurrentTime(2_200);
    act(() => first.lifecycle().onStateChange("playing"));
    act(() => vi.advanceTimersByTime(300));
    expect(first.port.pause).toHaveBeenCalled();

    const second = fakePlayer();
    view.rerender(<MediaLearningWorkbench audioPlayerFactory={second.factory} playback={{
      ...playback(), media: { ...playback().media, id: "podcast.episode43@1", stableKey: "podcast.episode43" },
    }} />);
    expect(first.port.destroy).toHaveBeenCalledOnce();
    act(() => first.lifecycle().onError("旧播放器错误"));
    expect(screen.queryByText("旧播放器错误")).not.toBeInTheDocument();
  });

  it("honestly degrades when an episode has no reviewed transcript", () => {
    const player = fakePlayer();
    render(<MediaLearningWorkbench audioPlayerFactory={player.factory} playback={playback(false)} />);
    expect(screen.getByText("这期播客可以播放，但目前没有已审核的逐句文本。")).toBeVisible();
    // With no reviewed lines the arrow keys must do nothing instead of throwing
    // or moving a player that has no segments to navigate.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(player.port.seek).not.toHaveBeenCalled();
  });

  it("shows a recoverable error when the current enclosure cannot play", () => {
    const player = fakePlayer();
    render(<MediaLearningWorkbench audioPlayerFactory={player.factory} playback={playback()} />);

    act(() => player.lifecycle().onError("播客音频暂时无法播放，请检查网络后重试。"));

    expect(screen.getByRole("alert")).toHaveTextContent("播客音频暂时无法播放，请检查网络后重试。");
  });

  it("keeps the audio player mounted and playing while the transcript arrives in two phases", async () => {
    const player = fakePlayer();
    const source = playback();
    const empty = { ...source, segments: [] };
    const view = render(<MediaLearningWorkbench audioPlayerFactory={player.factory} playback={empty} transcriptExpectedSegments={3} transcriptState={{ status: "loading" }} />);
    expect(player.factory).toHaveBeenCalledTimes(1);
    act(() => player.lifecycle().onReady());
    act(() => player.lifecycle().onStateChange("playing"));
    player.setCurrentTime(3_000);
    act(() => player.lifecycle().onPositionChange?.());
    expect(screen.getByText("正在播放")).toBeVisible();

    view.rerender(<MediaLearningWorkbench audioPlayerFactory={player.factory} playback={source} transcriptExpectedSegments={3} transcriptState={{ status: "text_ready", segments: source.segments, words: "loading" }} />);
    await act(async () => { await Promise.resolve(); });
    expect(player.factory).toHaveBeenCalledTimes(1);
    expect(player.port.destroy).not.toHaveBeenCalled();
    expect(player.port.currentTime()).toBe(3_000);
    expect(screen.getByText("正在播放")).toBeVisible();
    expect(screen.getByText("字幕已加载，逐词高亮准备中…")).toBeVisible();
    expect(view.container.querySelector("#segment-1")).toHaveClass("is-active");

    view.rerender(<MediaLearningWorkbench audioPlayerFactory={player.factory} playback={source} transcriptExpectedSegments={3} transcriptState={{ status: "ready", segments: source.segments }} />);
    await act(async () => { await Promise.resolve(); });
    expect(player.factory).toHaveBeenCalledTimes(1);
    expect(player.port.destroy).not.toHaveBeenCalled();
    expect(screen.queryByText("字幕已加载，逐词高亮准备中…")).not.toBeInTheDocument();
  });
});
