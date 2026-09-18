import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MediaLearningWorkbench,
  type VideoPlayerFactory,
  type VideoPlayerLifecycle,
  type VideoPlayerPort,
} from "@/src/modules/media";
import { mountPlyrAutoPauseControl } from "@/src/modules/media/ui/video-player-adapter";

function playback() {
  return {
    media: {
      id: "youtube.publicvideo1@1", stableKey: "youtube.publicvideo1", version: 1, kind: "video" as const,
      title: "Cómo pedir un café", summary: "Una conversación breve.", sourceName: "Español con calma", language: "es", region: "es-ES", cefr: "A2" as const,
      topics: ["topic.daily-life"], durationMs: 6_000, publishedAt: "2026-09-13T08:00:00.000Z", curatedAt: "2026-09-13T12:00:00.000Z", contentHash: "a".repeat(64),
      progress: { lastPositionMs: 0, lastSegmentIndex: 0, status: "in_progress" as const, revision: 2 },
    },
    asset: { kind: "official_embed" as const, url: "https://www.youtube-nocookie.com/embed/publicVideo1?enablejsapi=1", expiresAt: null },
    segments: [
      { id: "s0", index: 0, startMs: 0, endMs: 1_800, sourceText: "Buenos días.", translation: "早上好。", speaker: null, words: [
        { startMs: 100, endMs: 600, startOffset: 0, endOffset: 6 },
        { startMs: 700, endMs: 1_200, startOffset: 7, endOffset: 11 },
      ] },
      { id: "s1", index: 1, startMs: 1_800, endMs: 4_250, sourceText: "Quería un café con leche.", translation: "我想要一杯拿铁。", speaker: null, words: [
        { startMs: 1_900, endMs: 2_350, startOffset: 0, endOffset: 6 },
        { startMs: 2_400, endMs: 2_650, startOffset: 7, endOffset: 9 },
        { startMs: 2_700, endMs: 3_100, startOffset: 10, endOffset: 14 },
        { startMs: 3_150, endMs: 3_450, startOffset: 15, endOffset: 18 },
        { startMs: 3_500, endMs: 4_050, startOffset: 19, endOffset: 24 },
      ] },
      { id: "s2", index: 2, startMs: 4_250, endMs: 6_000, sourceText: "Claro.", translation: "当然。", speaker: null, words: [
        { startMs: 4_350, endMs: 4_900, startOffset: 0, endOffset: 5 },
      ] },
    ],
  };
}

function fakePlayer() {
  let lifecycle: VideoPlayerLifecycle | null = null;
  let currentTimeMs = 0;
  const port: VideoPlayerPort = {
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn((value) => { currentTimeMs = value; }),
    currentTime: vi.fn(() => currentTimeMs),
    destroy: vi.fn(),
  };
  const factory: VideoPlayerFactory = vi.fn((_target, input) => {
    lifecycle = input.lifecycle;
    return port;
  });
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

describe("video learning workbench", () => {
  it("restores the sentence from media time, not a stale saved segment index", () => {
    const data = playback();
    data.media.progress.lastPositionMs = 2000;
    data.media.progress.lastSegmentIndex = 0;
    const player = fakePlayer();
    render(<MediaLearningWorkbench playback={data} playerFactory={player.factory} />);
    expect(screen.getByRole("listitem", { current: true })).toHaveTextContent("Quería un café");
  });

  it("follows real playback across words and restores the previous sentence when the voice advances", () => {
    vi.useFakeTimers();
    const player = fakePlayer();
    render(<MediaLearningWorkbench playback={playback()} playerFactory={player.factory} />);
    act(() => player.lifecycle().onReady());
    act(() => player.lifecycle().onStateChange("playing"));

    player.setCurrentTime(250);
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole("button", { name: "查看词语 Buenos" })).toHaveClass("is-speaking");
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("aria-current", "true");

    player.setCurrentTime(850);
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole("button", { name: "查看词语 Buenos" })).not.toHaveClass("is-speaking");
    expect(screen.getByRole("button", { name: "查看词语 días" })).toHaveClass("is-speaking");

    player.setCurrentTime(2_000);
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getAllByRole("listitem")[0]).not.toHaveClass("is-active");
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "查看词语 días" })).not.toHaveClass("is-speaking");
    expect(screen.getByRole("button", { name: "查看词语 Quería" })).toHaveClass("is-speaking");
  });
  it("exposes a structured current-segment context for the responsive detail layout", () => {
    const player = fakePlayer();
    render(<MediaLearningWorkbench playback={playback()} playerFactory={player.factory} />);

    expect(screen.getByRole("region", { name: "视频学习器" })).toHaveClass("media-learning-workbench__main");
    expect(screen.getByRole("region", { name: "字幕与文本" })).toHaveClass("media-learning-workbench__transcript");
    expect(screen.getByLabelText("当前片段")).toHaveClass("media-current-segment");
    expect(screen.getByLabelText("当前片段")).toHaveTextContent("Buenos días.");
  });

  it("uses the native hosted video element for self-hosted assets", () => {
    const hosted = { ...playback(), asset: { kind: "video" as const, url: "https://media.example.test/video.mp4", expiresAt: null } };
    render(<MediaLearningWorkbench playback={hosted} />);

    const video = screen.getByRole("region", { name: "视频学习器" }).querySelector("video");
    expect(video).toHaveAttribute("src", "https://media.example.test/video.mp4");
    expect(video).toHaveAttribute("controls");
    fireEvent.loadedMetadata(video!);
    expect(screen.getByText("播放器已就绪")).toBeVisible();
  });

  it("mounts only auto-pause inside a Plyr control bar", () => {
    const controls = document.createElement("div");
    const player = { elements: { controls } };
    const onToggleAutoPause = vi.fn();
    const mounted = mountPlyrAutoPauseControl(player, { autoPause: false, disabled: false, onToggleAutoPause });
    document.body.appendChild(controls);

    expect(controls.querySelectorAll("[data-media-auto-pause-control]")).toHaveLength(1);
    expect(controls).not.toHaveTextContent("上一句");
    expect(controls).not.toHaveTextContent("重播当前句");
    expect(controls).not.toHaveTextContent("下一句");
    expect(controls).not.toHaveTextContent("自动暂停");
    expect(controls.querySelector("svg")).toBeInTheDocument();
    fireEvent.click(controls.querySelector("[data-media-auto-pause-control]")!);
    expect(onToggleAutoPause).toHaveBeenCalledOnce();

    mounted?.setAutoPause(true);
    expect(controls.querySelector("[data-media-auto-pause-control]")).toHaveAttribute("aria-pressed", "true");
    mounted?.destroy();
    expect(controls.querySelectorAll("[data-media-auto-pause-control]")).toHaveLength(0);

    const disabled = mountPlyrAutoPauseControl(player, { autoPause: false, disabled: true, onToggleAutoPause });
    expect(controls.querySelector("[data-media-auto-pause-control]")).toBeDisabled();
    expect(controls.querySelector("[data-media-auto-pause-control]")).toHaveAccessibleName("暂无已审核分句，无法自动暂停");
    disabled?.destroy();
  });

  it("supports transcript seeking, A/S/D/Q controls, caption modes and focus-restoring lexical drawer", async () => {
    const player = fakePlayer();
    const user = userEvent.setup();
    render(<MediaLearningWorkbench playback={playback()} playerFactory={player.factory} />);
    act(() => player.lifecycle().onReady());

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(player.port.seek).toHaveBeenLastCalledWith(1_800);
    expect(player.port.play).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "a" });
    expect(player.port.seek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(window, { key: "s" });
    expect(player.port.seek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(player.port.seek).toHaveBeenLastCalledWith(1_800);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(player.port.seek).toHaveBeenLastCalledWith(0);

    const playerSurface = screen.getByRole("region", { name: "视频学习器" }).querySelector(".media-detail__player");
    fireEvent.keyDown(playerSurface!, { key: "ArrowRight" });
    expect(player.port.seek).toHaveBeenLastCalledWith(1_800);

    fireEvent.keyDown(window, { key: "q" });
    expect(screen.queryByRole("checkbox", { name: "自动暂停" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "双语" }));
    expect(screen.getByText("早上好。")).toBeVisible();
    const word = screen.getByRole("button", { name: "查看词语 Buenos" });
    await user.click(word);
    expect(screen.getByRole("dialog", { name: "词句上下文" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "关闭词句上下文" }));
    expect(word).toHaveFocus();
  });

  it("uses Q to enable sentence-end auto-pause for video without restoring the old checkbox", () => {
    vi.useFakeTimers();
    const player = fakePlayer();
    render(<MediaLearningWorkbench playback={playback()} playerFactory={player.factory} />);
    act(() => player.lifecycle().onReady());

    fireEvent.keyDown(window, { key: "q" });
    expect(screen.queryByRole("checkbox", { name: "自动暂停" })).not.toBeInTheDocument();
    player.setCurrentTime(1_800);
    act(() => player.lifecycle().onStateChange("playing"));
    act(() => vi.advanceTimersByTime(100));

    expect(player.port.pause).toHaveBeenCalledOnce();
  });

  it("ignores stale player callbacks after replacement", () => {
    vi.useFakeTimers();
    const first = fakePlayer();
    const { rerender } = render(<MediaLearningWorkbench playback={playback()} playerFactory={first.factory} />);
    act(() => first.lifecycle().onReady());
    first.setCurrentTime(1_800);
    act(() => first.lifecycle().onStateChange("playing"));
    act(() => vi.advanceTimersByTime(300));
    expect(first.port.pause).not.toHaveBeenCalled();

    const second = fakePlayer();
    const nextPlayback = { ...playback(), media: { ...playback().media, id: "youtube.nextvideo2@1", stableKey: "youtube.nextvideo2", title: "Otro vídeo" }, asset: { ...playback().asset, url: "https://www.youtube-nocookie.com/embed/nextVideo2?enablejsapi=1" } };
    const stale = first.lifecycle();
    rerender(<MediaLearningWorkbench playback={nextPlayback} playerFactory={second.factory} />);
    act(() => stale.onError("old generation failed"));
    expect(screen.queryByText("old generation failed")).not.toBeInTheDocument();
  });

  it("synchronizes progress with revision CAS and exposes conflicts without accepting stale responses", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "MEDIA_PROGRESS_CONFLICT" } }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = fakePlayer();
    const view = render(<MediaLearningWorkbench playback={playback()} playerFactory={first.factory} />);
    act(() => first.lifecycle().onReady());
    first.setCurrentTime(2_500);
    act(() => first.lifecycle().onStateChange("paused"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      version: 1, expectedRevision: 2, lastPositionMs: 2_500, lastSegmentIndex: 1, status: "in_progress",
    });

    const second = fakePlayer();
    const nextPlayback = { ...playback(), media: { ...playback().media, id: "youtube.nextvideo2@1", stableKey: "youtube.nextvideo2", title: "Otro vídeo" }, asset: { ...playback().asset, url: "https://www.youtube-nocookie.com/embed/nextVideo2?enablejsapi=1" } };
    view.rerender(<MediaLearningWorkbench playback={nextPlayback} playerFactory={second.factory} />);
    resolveFirst?.(new Response(JSON.stringify({ data: { progress: { revision: 3 } } }), { status: 200 }));
    await act(async () => Promise.resolve());
    expect(screen.queryByText("进度已同步")).not.toBeInTheDocument();

    act(() => second.lifecycle().onReady());
    second.setCurrentTime(4_500);
    act(() => second.lifecycle().onStateChange("paused"));
    expect(await screen.findByText("进度已在其他页面更新，请刷新后继续。")).toBeVisible();
  });
});
