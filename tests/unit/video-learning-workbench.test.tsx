import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MediaLearningWorkbench,
  type NativeVideoPlayerFactory,
  type VideoPlayerFactory,
  type VideoPlayerLifecycle,
  type VideoPlayerPort,
  type MediaPlayback,
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

describe("workbench series completion lifecycle", () => {
  const summary = { seriesKey: "series.workbench", title: "Historias", kind: "video" as const, orderMode: "ordered" as const, revision: 1, seasonNumber: null, episodeNumber: null, episodeLabel: null };
  function seriesPlayback(native = false): MediaPlayback {
    const source = playback();
    return { ...source, media: { ...source.media, series: summary }, asset: native ? { kind: "video", url: "https://media.example.test/sample.mp4", expiresAt: null } : source.asset };
  }
  function installRequests(progressFails = false) {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/series-recommendations")) return new Response(JSON.stringify({ apiVersion: "v1", data: {
        series: { ...summary, summary: "Historias", status: "active", episodeCount: 2 },
        items: [{ ...seriesPlayback().media, id: "video.next@1", stableKey: "video.next", title: "Otra historia" }],
      } }));
      return new Response(JSON.stringify({ data: { progress: { revision: 3 } } }), { status: progressFails ? 503 : 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return () => fetchMock.mock.calls.filter(([url]) => url.endsWith("/series-recommendations"));
  }

  it.each([false, true])("shows recommendations only for current ended, clears on seek/replay and refreshes (native=%s)", async (native) => {
    const requests = installRequests(true);
    const player = native ? fakeNativePlayer() : fakePlayer();
    render(<MediaLearningWorkbench playback={seriesPlayback(native)} {...(native ? { nativeVideoFactory: player.factory as NativeVideoPlayerFactory } : { playerFactory: player.factory as VideoPlayerFactory })} />);
    act(() => player.lifecycle().onReady());
    player.setCurrentTime(5_999);
    act(() => player.lifecycle().onPositionChange?.());
    act(() => player.lifecycle().onStateChange("paused"));
    expect(requests()).toHaveLength(0);
    player.setCurrentTime(6_000);
    act(() => player.lifecycle().onStateChange("ended"));
    expect(await screen.findByRole("heading", { name: "当前系列的其他视频" })).toBeVisible();
    expect(screen.getByText("本次进度未能同步，暂停或继续播放时会重试。")).toBeVisible();
    act(() => player.lifecycle().onStateChange("ended"));
    expect(requests()).toHaveLength(1);
    player.setCurrentTime(2_000);
    act(() => player.lifecycle().onPositionChange?.());
    expect(screen.queryByRole("heading", { name: "当前系列的其他视频" })).not.toBeInTheDocument();
    player.setCurrentTime(6_000);
    act(() => player.lifecycle().onStateChange("ended"));
    await screen.findByRole("heading", { name: "当前系列的其他视频" });
    expect(requests()).toHaveLength(2);
    fireEvent.keyDown(window, { key: "s" });
    expect(screen.queryByRole("heading", { name: "当前系列的其他视频" })).not.toBeInTheDocument();
    expect(player.port.play).toHaveBeenCalledTimes(1);
  });

  it("does not infer completion from historical progress, auto-pause or near-end position", async () => {
    vi.useFakeTimers();
    const requests = installRequests();
    const player = fakePlayer();
    const source = seriesPlayback();
    render(<MediaLearningWorkbench playback={{ ...source, media: { ...source.media, progress: { status: "completed", lastPositionMs: 6_000, lastSegmentIndex: 2, revision: 2 } } }} playerFactory={player.factory} />);
    act(() => player.lifecycle().onReady());
    fireEvent.keyDown(window, { key: "q" });
    fireEvent.keyDown(window, { key: "s" });
    player.setCurrentTime(6_000);
    act(() => player.lifecycle().onStateChange("playing"));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(player.port.pause).toHaveBeenCalled();
    expect(requests()).toHaveLength(0);
  });

  it.each([false, true])("does not recommend after a technical failure until the player recovers (native=%s)", async (native) => {
    const requests = installRequests();
    const player = native ? fakeNativePlayer() : fakePlayer();
    render(<MediaLearningWorkbench playback={seriesPlayback(native)} {...(native ? { nativeVideoFactory: player.factory as NativeVideoPlayerFactory } : { playerFactory: player.factory as VideoPlayerFactory })} />);
    act(() => player.lifecycle().onReady());
    act(() => player.lifecycle().onError("Media failed"));
    act(() => player.lifecycle().onStateChange("ended"));
    expect(requests()).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "当前系列的其他视频" })).not.toBeInTheDocument();
    act(() => player.lifecycle().onReady());
    act(() => player.lifecycle().onStateChange("ended"));
    await screen.findByRole("heading", { name: "当前系列的其他视频" });
    expect(requests()).toHaveLength(1);
    act(() => player.lifecycle().onError("Another failure"));
    expect(screen.queryByRole("heading", { name: "当前系列的其他视频" })).not.toBeInTheDocument();
  });

  it("clears on player replacement and ignores old ended callbacks after instance, asset or version changes", async () => {
    const requests = installRequests();
    const source = seriesPlayback();
    const first = fakePlayer();
    const second = fakePlayer();
    const view = render(<MediaLearningWorkbench playback={source} playerFactory={first.factory} />);
    act(() => first.lifecycle().onReady());
    act(() => first.lifecycle().onStateChange("ended"));
    await screen.findByRole("heading", { name: "当前系列的其他视频" });
    const stale = first.lifecycle();
    view.rerender(<MediaLearningWorkbench playback={source} playerFactory={second.factory} />);
    expect(screen.queryByRole("heading", { name: "当前系列的其他视频" })).not.toBeInTheDocument();
    act(() => stale.onStateChange("ended"));
    expect(requests()).toHaveLength(1);
    act(() => second.lifecycle().onReady());
    act(() => second.lifecycle().onStateChange("ended"));
    await screen.findByRole("heading", { name: "当前系列的其他视频" });
    const priorAsset = second.lifecycle();
    view.rerender(<MediaLearningWorkbench playback={{ ...source, asset: { ...source.asset, url: "https://www.youtube-nocookie.com/embed/otherVideo2?enablejsapi=1" } }} playerFactory={second.factory} />);
    act(() => priorAsset.onStateChange("ended"));
    expect(screen.queryByRole("heading", { name: "当前系列的其他视频" })).not.toBeInTheDocument();
    const priorVersion = second.lifecycle();
    view.rerender(<MediaLearningWorkbench playback={{ ...source, media: { ...source.media, id: `${source.media.stableKey}@2`, version: 2 } }} playerFactory={second.factory} />);
    act(() => priorVersion.onStateChange("ended"));
    expect(requests()).toHaveLength(2);
    act(() => second.lifecycle().onReady());
    act(() => second.lifecycle().onStateChange("ended"));
    await screen.findByRole("heading", { name: "当前系列的其他视频" });
    const beforeRetry = second.lifecycle();
    act(() => beforeRetry.onError("Playback failed"));
    fireEvent.click(screen.getByRole("button", { name: "重试播放" }));
    act(() => beforeRetry.onStateChange("ended"));
    expect(screen.queryByRole("heading", { name: "当前系列的其他视频" })).not.toBeInTheDocument();
    expect(requests()).toHaveLength(3);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("video learning workbench", () => {
  it("highlights and navigates the transcript tail beyond cue 500", () => {
    vi.useFakeTimers();
    const player = fakePlayer();
    const longPlayback = {
      ...playback(),
      media: { ...playback().media, durationMs: 848_000 },
      segments: Array.from({ length: 848 }, (_, index) => ({
        id: `long-${index}`, index, startMs: index * 1_000, endMs: (index + 1) * 1_000,
        sourceText: "Hola.", translation: null, speaker: null,
        words: [{ text: "Hola", startOffset: 0, endOffset: 4, startMs: index * 1_000, endMs: (index + 1) * 1_000 }],
      })),
    };
    const view = render(<MediaLearningWorkbench playback={longPlayback} playerFactory={player.factory} />);
    act(() => player.lifecycle().onReady());
    player.setCurrentTime(846_100);
    act(() => player.lifecycle().onStateChange("playing"));
    act(() => vi.advanceTimersByTime(300));
    expect(view.container.querySelector("#segment-846 [data-active-word='true']")).toHaveTextContent("Hola");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(player.port.seek).toHaveBeenLastCalledWith(847_000);
    expect(view.container.querySelector("#segment-847 [data-active-word='true']")).toHaveTextContent("Hola");
    fireEvent.keyDown(window, { key: "a" });
    expect(player.port.seek).toHaveBeenLastCalledWith(846_000);
  });

  it("pauses for word lookup, lets panel buttons own their keyboard events, and never resumes on close", async () => {
    const user = userEvent.setup();
    const player = fakePlayer();
    render(<MediaLearningWorkbench playback={playback()} playerFactory={player.factory} />);
    act(() => player.lifecycle().onReady());
    act(() => player.lifecycle().onStateChange("playing"));
    const word = screen.getByRole("button", { name: "查看词语 Buenos" });
    await user.click(word);
    expect(player.port.pause).toHaveBeenCalledTimes(1);
    const close = screen.getByRole("button", { name: "关闭词句上下文" });
    fireEvent.keyDown(close, { key: " ", code: "Space" });
    fireEvent.keyDown(close, { key: "ArrowRight" });
    expect(player.port.play).not.toHaveBeenCalled();
    expect(player.port.seek).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(word).toHaveFocus();
    expect(player.port.play).not.toHaveBeenCalled();
  });
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

  it("resolves a deep-linked segment by its stable index after unreviewed cues are omitted", () => {
    const player = fakePlayer();
    const sparse = { ...playback(), segments: [playback().segments[0]!, playback().segments[2]!] };
    const view = render(<MediaLearningWorkbench initialSegmentIndex={2} playback={sparse} playerFactory={player.factory} />);
    act(() => player.lifecycle().onReady());
    expect(player.port.seek).toHaveBeenCalledWith(4_250);
    expect(view.container.querySelector("#segment-2")).toHaveClass("is-active");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(player.port.seek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(player.port.seek).toHaveBeenLastCalledWith(4_250);
    fireEvent.click(view.container.querySelector<HTMLButtonElement>("#segment-2 .segment-transcript__time")!);
    expect(player.port.seek).toHaveBeenLastCalledWith(4_250);
  });

  it("falls back to the first available stable cue index before playback is ready", () => {
    const player = fakePlayer();
    const source = playback();
    const sparse = { ...source, media: { ...source.media, progress: null }, segments: [source.segments[2]!] };
    const view = render(<MediaLearningWorkbench playback={sparse} playerFactory={player.factory} />);
    expect(view.container.querySelector("#segment-2")).toHaveClass("is-active");
  });

  it.each([[0, 0], [2500, 1]])("prioritizes explicit time %i over a conflicting segment before and after ready", (time, index) => {
    const player = fakePlayer();
    const view = render(<MediaLearningWorkbench initialPositionMs={time} initialSegmentIndex={2} playback={playback()} playerFactory={player.factory} />);
    expect(view.container.querySelector(`#segment-${index}`)).toHaveClass("is-active");
    act(() => player.lifecycle().onReady());
    expect(view.container.querySelector(`#segment-${index}`)).toHaveClass("is-active");
    if (time > 0) expect(player.port.seek).toHaveBeenLastCalledWith(time);
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

    expect(screen.queryByRole("checkbox", { name: "自动暂停" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "q" });

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
    fireEvent.keyDown(window, { key: "q" });
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

describe("progressive transcript arrival", () => {
  function emptyPlayback() {
    return { ...playback(), segments: [] };
  }

  it("keeps the player mounted, playing and positioned when the transcript arrives later", async () => {
    const player = fakePlayer();
    const view = render(<MediaLearningWorkbench playback={emptyPlayback()} playerFactory={player.factory} transcriptExpectedSegments={3} transcriptState={{ status: "loading" }} />);
    expect(player.factory).toHaveBeenCalledTimes(1);
    act(() => player.lifecycle().onReady());
    act(() => player.lifecycle().onStateChange("playing"));
    player.setCurrentTime(2_500);
    act(() => player.lifecycle().onPositionChange?.());
    // Loading state never fabricates a "current segment" from missing cues.
    expect(screen.queryByRole("group", { name: "当前片段" })).not.toBeInTheDocument();

    view.rerender(<MediaLearningWorkbench playback={playback()} playerFactory={player.factory} transcriptExpectedSegments={3} transcriptState={{ status: "ready", segments: playback().segments }} />);
    await act(async () => { await Promise.resolve(); });
    expect(player.factory).toHaveBeenCalledTimes(1);
    expect(player.port.destroy).not.toHaveBeenCalled();
    expect(player.port.currentTime()).toBe(2_500);
    expect(screen.getByText("正在播放")).toBeVisible();
    expect(view.container.querySelector("#segment-1")).toHaveClass("is-active");
    expect(screen.getByRole("group", { name: "当前片段" })).toHaveTextContent("Quería un café con leche.");
  });

  it("shows the loading placeholder instead of a stale current segment, then fills the transcript count", async () => {
    const player = fakePlayer();
    const source = playback();
    const view = render(<MediaLearningWorkbench playback={emptyPlayback()} playerFactory={player.factory} transcriptExpectedSegments={3} transcriptState={{ status: "loading" }} />);
    expect(screen.getByText("字幕正在加载…")).toBeVisible();
    expect(screen.getByText("字幕加载中…")).toBeVisible();
    expect(view.container.querySelector(".media-current-segment--loading")).not.toBeNull();
    expect(screen.queryByText("3 段")).not.toBeInTheDocument();

    view.rerender(<MediaLearningWorkbench playback={source} playerFactory={player.factory} transcriptExpectedSegments={3} transcriptState={{ status: "ready", segments: source.segments }} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText("字幕正在加载…")).not.toBeInTheDocument();
    expect(screen.getByText("3 段")).toBeVisible();
    expect(view.container.querySelector(".media-current-segment--loading")).toBeNull();
  });

  it("applies a ?segment= deep link once the cues arrive, only when no ?t= was given", async () => {
    const player = fakePlayer();
    const view = render(<MediaLearningWorkbench initialSegmentIndex={2} playback={emptyPlayback()} playerFactory={player.factory} transcriptExpectedSegments={3} transcriptState={{ status: "loading" }} />);
    act(() => player.lifecycle().onReady());
    // No cue was resolvable at mount, so nothing was seeked yet.
    expect(player.port.seek).not.toHaveBeenCalled();

    view.rerender(<MediaLearningWorkbench initialSegmentIndex={2} playback={playback()} playerFactory={player.factory} transcriptExpectedSegments={3} transcriptState={{ status: "text_ready", segments: playback().segments, words: "loading" }} />);
    await act(async () => { await Promise.resolve(); });
    expect(player.port.seek).toHaveBeenCalledTimes(1);
    expect(player.port.seek).toHaveBeenLastCalledWith(4_250);
    expect(view.container.querySelector("#segment-2")).toHaveClass("is-active");
    // A later ready announcement must not apply the old resume position again.
    act(() => player.lifecycle().onReady());
    expect(player.port.seek).toHaveBeenCalledTimes(1);
  });

  it("keeps ?t= priority over a linked segment when the transcript arrives", async () => {
    const player = fakePlayer();
    const view = render(<MediaLearningWorkbench initialPositionMs={2_500} initialSegmentIndex={2} playback={emptyPlayback()} playerFactory={player.factory} transcriptExpectedSegments={3} transcriptState={{ status: "text_ready", segments: [], words: "loading" }} />);
    act(() => player.lifecycle().onReady());
    expect(player.port.seek).toHaveBeenLastCalledWith(2_500);
    view.rerender(<MediaLearningWorkbench initialPositionMs={2_500} initialSegmentIndex={2} playback={playback()} playerFactory={player.factory} transcriptExpectedSegments={3} transcriptState={{ status: "text_ready", segments: playback().segments, words: "loading" }} />);
    await act(async () => { await Promise.resolve(); });
    // The explicit time wins; the deep-linked segment index does not seek.
    expect(player.port.seek).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector("#segment-1")).toHaveClass("is-active");
  });

  it("keeps the player usable and surfaces a retry while the transcript text failed", () => {
    const retry = vi.fn();
    const player = fakePlayer();
    render(<MediaLearningWorkbench playback={emptyPlayback()} onTranscriptRetry={retry} playerFactory={player.factory} transcriptExpectedSegments={3} transcriptState={{ status: "error", message: "字幕暂时无法加载，可重试。" }} />);
    expect(player.factory).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("字幕暂时无法加载，可重试。");
    fireEvent.click(screen.getByRole("button", { name: "重试加载字幕" }));
    expect(retry).toHaveBeenCalledTimes(1);
    act(() => player.lifecycle().onReady());
    expect(screen.getByText("播放器已就绪")).toBeVisible();
  });
});
