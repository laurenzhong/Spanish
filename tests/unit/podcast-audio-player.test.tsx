import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MediaLearningWorkbench,
  type AudioPlayerFactory,
  type AudioPlayerLifecycle,
  type AudioPlayerPort,
} from "@/src/modules/media";

const plyrMock = vi.hoisted(() => ({ instances: [] as Array<{
  options: Readonly<Record<string, unknown>>;
  callbacks: Map<string, Set<() => void>>;
}> }));

vi.mock("plyr", () => ({
  default: class MockPlyr {
    currentTime = 0;
    callbacks = new Map<string, Set<() => void>>();
    elements = { controls: document.createElement("div") };
    media: HTMLElement & { error?: { code?: number } };
    options: Readonly<Record<string, unknown>>;

    constructor(target: HTMLElement, options: Readonly<Record<string, unknown>>) {
      this.media = target;
      this.options = options;
      target.parentElement?.appendChild(this.elements.controls);
      plyrMock.instances.push(this);
      queueMicrotask(() => this.emit("ready"));
    }

    emit(event: string) { this.callbacks.get(event)?.forEach((callback) => callback()); }
    on(event: string, callback: () => void) {
      const callbacks = this.callbacks.get(event) ?? new Set();
      callbacks.add(callback);
      this.callbacks.set(event, callbacks);
    }
    off(event: string, callback: () => void) { this.callbacks.get(event)?.delete(callback); }
    play() { this.emit("play"); return Promise.resolve(); }
    pause() { this.emit("pause"); }
    destroy() { this.callbacks.clear(); this.elements.controls.remove(); }
  },
}));

function playback(withTranscript = true) {
  return {
    media: {
      id: "podcast.episode42@1", stableKey: "podcast.episode42", version: 1, kind: "podcast" as const,
      title: "Una mañana en el mercado", summary: "Una charla breve.", sourceName: "Café de cada día", language: "es",
      region: "es-ES", cefr: "A2" as const, topics: ["topic.daily-life"], durationMs: 7_000,
      publishedAt: "2026-09-13T08:00:00.000Z", curatedAt: "2026-09-14T10:00:00.000Z", contentHash: "a".repeat(64),
      artwork: { url: "https://images.example.test/podcast.jpg", alt: "Café de cada día", source: "podcast-feed" as const, width: 600, height: 600, expiresAt: null },
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
  plyrMock.instances.length = 0;
  vi.unstubAllGlobals();
});

describe("podcast audio player", () => {
  it("uses the shared Plyr surface and icon-only auto-pause control", async () => {
    const view = render(<MediaLearningWorkbench playback={playback()} />);

    await waitFor(() => expect(plyrMock.instances).toHaveLength(1));
    expect(plyrMock.instances[0]?.options).toMatchObject({ settings: ["speed"] });
    const autoPause = view.container.querySelector<HTMLButtonElement>("[data-media-auto-pause-control]")!;
    expect(autoPause).toHaveAccessibleName("开启自动暂停");
    expect(autoPause).toHaveTextContent("");
    expect(autoPause.querySelector("svg")).toBeInTheDocument();
    fireEvent.click(autoPause);
    expect(autoPause).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("group", { name: "逐句播放控制" })).not.toBeInTheDocument();
  });

  it("uses keyboard sentence navigation, transcript drawer, and revisioned progress", async () => {
    const player = fakePlayer();
    const user = userEvent.setup();
    render(<MediaLearningWorkbench audioPlayerFactory={player.factory} playback={playback()} />);
    act(() => player.lifecycle().onReady());
    expect(screen.getByLabelText("Una mañana en el mercado 播放器")).toBeInTheDocument();
    expect(screen.getByAltText("Café de cada día")).toHaveAttribute("src", "https://images.example.test/podcast.jpg");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(player.port.seek).toHaveBeenLastCalledWith(2_200);
    expect(player.port.play).toHaveBeenCalled();

    const word = screen.getByRole("button", { name: "查看词语 Buenos" });
    await user.click(word);
    await user.click(screen.getByRole("button", { name: "关闭词句上下文" }));
    expect(word).toHaveFocus();

    player.setCurrentTime(3_000);
    act(() => player.lifecycle().onTimeUpdate(3_000));
    expect(screen.getAllByRole("listitem")[1]).toHaveClass("is-active");
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
    fireEvent.click(screen.getByRole("checkbox", { name: "自动暂停" }));
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
    expect(screen.getByText("暂无已审核字幕")).toBeVisible();
    expect(screen.queryByRole("group", { name: "字幕模式" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上一句" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下一句" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "自动暂停" })).toBeDisabled();
  });

  it("shows a recoverable error when the current enclosure cannot play", () => {
    const player = fakePlayer();
    render(<MediaLearningWorkbench audioPlayerFactory={player.factory} playback={playback()} />);

    act(() => player.lifecycle().onError("播客音频暂时无法播放，请检查网络后重试。"));

    expect(screen.getByRole("alert")).toHaveTextContent("播客音频暂时无法播放，请检查网络后重试。");
    expect(screen.getByRole("button", { name: "重试播放" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试播放" }));
    expect(screen.queryByRole("button", { name: "重试播放" })).not.toBeInTheDocument();
  });

  it("keeps the active transcript line in sync while audio is playing", () => {
    vi.useFakeTimers();
    const player = fakePlayer();
    render(<MediaLearningWorkbench audioPlayerFactory={player.factory} playback={playback()} />);
    act(() => player.lifecycle().onReady());
    act(() => player.lifecycle().onStateChange("playing"));

    player.setCurrentTime(3_000);
    act(() => vi.advanceTimersByTime(300));

    const lines = screen.getAllByRole("listitem");
    expect(lines[1]).toHaveClass("is-active");
    expect(lines[0]).not.toHaveClass("is-active");
  });
});
