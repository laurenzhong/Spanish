import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MediaLearningWorkbench,
  type NativeVideoPlayerFactory,
  type VideoPlayerFactory,
  type VideoPlayerLifecycle,
  type VideoPlayerPort,
} from "@/src/modules/media";

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
        { startMs: 0, endMs: 700, startOffset: 0, endOffset: 6, text: "Buenos" },
        { startMs: 700, endMs: 1_800, startOffset: 7, endOffset: 11, text: "días" },
      ] },
      { id: "s1", index: 1, startMs: 1_800, endMs: 4_250, sourceText: "Quería un café con leche.", translation: "我想要一杯拿铁。", speaker: null },
      { id: "s2", index: 2, startMs: 4_250, endMs: 6_000, sourceText: "Claro.", translation: "当然。", speaker: null },
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

function fakeNativePlayer() {
  let lifecycle: VideoPlayerLifecycle | null = null;
  let currentTimeMs = 0;
  const port: VideoPlayerPort = {
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn((value) => { currentTimeMs = value; }),
    currentTime: vi.fn(() => currentTimeMs),
    destroy: vi.fn(),
  };
  const factory: NativeVideoPlayerFactory = vi.fn((_element, input) => {
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
  it("uses the same workbench for licensed native video assets", async () => {
    const player = fakeNativePlayer();
    const nativePlayback = {
      ...playback(),
      media: { ...playback().media, id: "video.native@1", stableKey: "video.native" },
      asset: { kind: "video" as const, url: "https://media.example.test/video/sample.mp4", expiresAt: null },
    };
    render(<MediaLearningWorkbench nativeVideoFactory={player.factory} playback={nativePlayback} />);
    expect(player.factory).toHaveBeenCalledWith(expect.any(HTMLVideoElement), expect.objectContaining({ url: nativePlayback.asset.url }));
    act(() => player.lifecycle().onReady());
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(player.port.seek).toHaveBeenLastCalledWith(1_800);
  });

  it("applies the saved position once even when the player reports ready again", () => {
    const player = fakePlayer();
    render(<MediaLearningWorkbench initialPositionMs={4_250} playback={playback()} playerFactory={player.factory} />);

    act(() => player.lifecycle().onReady());
    expect(player.port.seek).toHaveBeenCalledTimes(1);

    // Plyr announces `ready` again after a source reload. Re-seeking there yanked
    // playback back to the saved position over and over, which is what made the
    // picture tear while the player still claimed to be playing.
    act(() => player.lifecycle().onReady());
    act(() => player.lifecycle().onReady());
    expect(player.port.seek).toHaveBeenCalledTimes(1);
  });

  it("honors a source deep link before saved progress", () => {
    const player = fakePlayer();
    const view = render(<MediaLearningWorkbench initialPositionMs={4_250} initialSegmentIndex={2} playback={playback()} playerFactory={player.factory} />);
    act(() => player.lifecycle().onReady());
    expect(player.port.seek).toHaveBeenCalledWith(4_250);
    expect(view.container.querySelector("#segment-2")).toBeInTheDocument();
  });

  it("supports transcript seeking, arrow/A-S-D/Q keys, caption modes and focus-restoring lexical drawer", async () => {
    const player = fakePlayer();
    const user = userEvent.setup();
    render(<MediaLearningWorkbench playback={playback()} playerFactory={player.factory} />);
    act(() => player.lifecycle().onReady());

    // Sentence navigation is keyboard-only: the owner already uses the arrow
    // keys, so the workbench renders no button row for it.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(player.port.seek).toHaveBeenLastCalledWith(1_800);
    expect(player.port.play).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(player.port.seek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(window, { key: "a" });
    expect(player.port.seek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(window, { key: "s" });
    expect(player.port.seek).toHaveBeenLastCalledWith(0);
    expect(screen.queryByRole("button", { name: "下一句" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /播放速度/ })).not.toBeInTheDocument();

    const autoPause = screen.getByRole("checkbox", { name: "自动暂停" });
    expect(autoPause).not.toBeChecked();
    fireEvent.keyDown(window, { key: "q" });
    expect(autoPause).toBeChecked();

    await user.click(screen.getByRole("button", { name: "双语" }));
    // The active line's translation is now also shown in the "当前片段" card,
    // so assert inside the transcript region instead of the whole document.
    expect(within(screen.getByRole("region", { name: "字幕与文本" })).getByText("早上好。")).toBeVisible();
    const word = screen.getByRole("button", { name: "查看词语 Buenos" });
    await user.click(word);
    expect(screen.getByRole("dialog", { name: "词句上下文" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "关闭词句上下文" }));
    expect(word).toHaveFocus();
  });

  it("plays and pauses on Space without needing to focus the player first", async () => {
    const player = fakePlayer();
    render(<MediaLearningWorkbench playback={playback()} playerFactory={player.factory} />);
    act(() => player.lifecycle().onReady());

    // Space plays when paused …
    fireEvent.keyDown(window, { key: " " });
    expect(player.port.play).toHaveBeenCalled();

    // … and pauses once the player reports it is playing.
    act(() => player.lifecycle().onStateChange("playing"));
    fireEvent.keyDown(window, { key: " " });
    expect(player.port.pause).toHaveBeenCalled();

    // A space typed into a text field must still be a space.
    const box = document.createElement("input");
    document.body.append(box);
    fireEvent.keyDown(box, { key: " " });
    expect(player.port.pause).toHaveBeenCalledTimes(1);
    box.remove();
  });

  it("ignores Space (and other keys) until the player reports it is mounted", () => {
    const player = fakePlayer();
    render(<MediaLearningWorkbench playback={playback()} playerFactory={player.factory} />);

    // No onReady() yet: the player is still mounting, so nothing may be toggled.
    fireEvent.keyDown(window, { key: " " });
    expect(player.port.play).not.toHaveBeenCalled();
    expect(player.port.pause).not.toHaveBeenCalled();

    act(() => player.lifecycle().onReady());
    fireEvent.keyDown(window, { key: " " });
    expect(player.port.play).toHaveBeenCalled();
  });

  it("follows playback time with a current word selection inside the active subtitle", () => {
    vi.useFakeTimers();
    const player = fakePlayer();
    render(<MediaLearningWorkbench playback={playback()} playerFactory={player.factory} />);
    act(() => player.lifecycle().onReady());
    player.setCurrentTime(900);
    act(() => player.lifecycle().onStateChange("playing"));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("button", { name: "查看词语 días" })).toHaveAttribute("data-active-word", "true");
    expect(screen.getByRole("button", { name: "查看词语 Buenos" })).not.toHaveAttribute("data-active-word", "true");
  });

  it("keeps numeric word boundaries aligned with the reviewed timeline", () => {
    vi.useFakeTimers();
    const player = fakePlayer();
    const numericPlayback = {
      ...playback(),
      media: { ...playback().media, id: "youtube.numeric@1", stableKey: "youtube.numeric" },
      segments: [{
        id: "numeric", index: 0, startMs: 0, endMs: 3_000, sourceText: "Nivel A2 a las 2:33.", translation: null, speaker: null,
        words: [
          { startMs: 0, endMs: 500, startOffset: 0, endOffset: 5, text: "Nivel" },
          { startMs: 500, endMs: 1_000, startOffset: 6, endOffset: 8, text: "A2" },
          { startMs: 1_000, endMs: 1_500, startOffset: 9, endOffset: 10, text: "a" },
          { startMs: 1_500, endMs: 2_000, startOffset: 11, endOffset: 14, text: "las" },
          { startMs: 2_000, endMs: 3_000, startOffset: 15, endOffset: 19, text: "2:33" },
        ],
      }],
    };
    render(<MediaLearningWorkbench playback={numericPlayback} playerFactory={player.factory} />);
    act(() => player.lifecycle().onReady());
    player.setCurrentTime(700);
    act(() => player.lifecycle().onStateChange("playing"));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("button", { name: "查看词语 A2" })).toHaveAttribute("data-active-word", "true");
    expect(screen.getByRole("button", { name: "查看词语 2:33" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看词语 A2" })).toHaveClass("is-speaking");
  });

  it("syncs a paused native seek and clears the active segment outside reviewed cues", () => {
    const player = fakeNativePlayer();
    const nativePlayback = {
      ...playback(),
      media: { ...playback().media, id: "video.seek@1", stableKey: "video.seek" },
      asset: { kind: "video" as const, url: "https://media.example.test/video/seek.mp4", expiresAt: null },
    };
    const view = render(<MediaLearningWorkbench nativeVideoFactory={player.factory} playback={nativePlayback} />);
    act(() => player.lifecycle().onReady());
    player.setCurrentTime(4_500);
    act(() => player.lifecycle().onPositionChange?.());
    expect(view.container.querySelector("#segment-2")).toHaveClass("is-active");
    player.setCurrentTime(6_000);
    act(() => player.lifecycle().onPositionChange?.());
    expect(view.container.querySelector("#segment-2")).not.toHaveClass("is-active");
  });

  it("auto-pauses at the reviewed segment boundary and ignores stale player callbacks after replacement", () => {
    vi.useFakeTimers();
    const first = fakePlayer();
    const { rerender } = render(<MediaLearningWorkbench playback={playback()} playerFactory={first.factory} />);
    act(() => first.lifecycle().onReady());
    fireEvent.click(screen.getByRole("checkbox", { name: "自动暂停" }));
    first.setCurrentTime(1_800);
    act(() => first.lifecycle().onStateChange("playing"));
    act(() => vi.advanceTimersByTime(300));
    expect(first.port.pause).toHaveBeenCalled();

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
    // A conflict no longer tells the reader to reload the page: the workbench
    // offers a control that re-reads the server revision in place.
    expect(await screen.findByText("进度已在其他页面更新。重新读取服务器进度后即可继续同步，不需要刷新整个页面。")).toBeVisible();
    expect(screen.getByRole("button", { name: "重新读取服务器进度" })).toBeInTheDocument();
  });
});
