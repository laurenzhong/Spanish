import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaLearningWorkbench } from "@/src/modules/media";
import { disableNativeMediaControls } from "@/src/modules/media/ui/media-plyr";
import { HostedVideoPlayerAdapter, VideoPlayerAdapter } from "@/src/modules/media/ui/video-player-adapter";
import { AudioPlayerAdapter } from "@/src/modules/media/ui/audio-player-adapter";

const plyrMock = vi.hoisted(() => ({
  instances: [] as Array<{ target: HTMLElement; options: Readonly<Record<string, unknown>>; emit: (event: string) => void; destroy: ReturnType<typeof vi.fn> }>,
}));

vi.mock("plyr", () => ({
  default: class MockPlyr {
    currentTime = 0;
    elements = {
      container: document.createElement("div"),
      controls: document.createElement("div"),
    };
    media: HTMLElement & { error?: { code?: number } };
    private callbacks = new Map<string, Set<() => void>>();

    constructor(target: HTMLElement, options: Readonly<Record<string, unknown>>) {
      this.media = target;
      this.elements.container.className = "plyr";
      target.parentElement?.appendChild(this.elements.container);
      this.elements.container.append(target, this.elements.controls);
      const original = target.cloneNode(true);
      this.destroy = vi.fn(() => {
        this.callbacks.clear();
        this.elements.container.replaceWith(original);
      });
      plyrMock.instances.push({ target, options, emit: (event) => this.callbacks.get(event)?.forEach((callback) => callback()), destroy: this.destroy });
    }

    on(event: string, callback: () => void) {
      const callbacks = this.callbacks.get(event) ?? new Set<() => void>();
      callbacks.add(callback);
      this.callbacks.set(event, callbacks);
    }

    off(event: string, callback: () => void) {
      this.callbacks.get(event)?.delete(callback);
    }

    play() { return Promise.resolve(); }
    pause() {}
    destroy = vi.fn();
  },
}));

function media(kind: "podcast" | "video") {
  return {
    media: {
      id: `${kind}.plyr@1`, stableKey: `${kind}.plyr`, version: 1, kind,
      title: kind === "podcast" ? "Podcast" : "Video", summary: "Summary", sourceName: "Source", language: "es",
      region: "es-ES", cefr: "A2" as const, topics: [], durationMs: 10_000,
      publishedAt: "2026-09-20T00:00:00.000Z", curatedAt: "2026-09-20T00:00:00.000Z", contentHash: "a".repeat(64),
      artwork: null, progress: null,
    },
    asset: kind === "podcast"
      ? { kind: "audio" as const, url: "https://media.example.test/audio.mp3", expiresAt: null }
      : { kind: "video" as const, url: "https://media.example.test/video.mp4", expiresAt: null },
    segments: [],
  };
}

afterEach(() => {
  cleanup();
  plyrMock.instances.length = 0;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("default media player", () => {
  it.each(["video", "podcast"] as const)("keeps an early %s resource failure visible until a fresh retry", async (kind) => {
    const setSource = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!.set!;
    let fail = true;
    const source = vi.spyOn(HTMLMediaElement.prototype, "src", "set").mockImplementation(function (this: HTMLMediaElement, url) {
      setSource.call(this, url);
      if (!fail) return;
      Object.defineProperty(this, "error", { value: { code: 4 } });
      this.dispatchEvent(new Event("error"));
    });
    try {
      render(<MediaLearningWorkbench playback={media(kind)} />);
      await waitFor(() => expect(plyrMock.instances).toHaveLength(1));
      act(() => plyrMock.instances[0]!.emit("ready"));
      expect(screen.getByRole("alert")).toHaveTextContent(/暂时无法播放/);
      const first = plyrMock.instances[0]!.target;
      fail = false;
      fireEvent.click(screen.getByRole("button", { name: "重试播放" }));
      await waitFor(() => expect(plyrMock.instances).toHaveLength(2));
      const second = plyrMock.instances[1]!.target;
      expect(second).not.toBe(first);
      fireEvent(second, new Event("canplay"));
      expect(screen.getByText("播放器已就绪")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "重试播放" })).not.toBeInTheDocument();
    } finally {
      source.mockRestore();
    }
  });

  it.each(["video", "podcast"] as const)("distinguishes the %s play request, rebuffering and actual playback", async (kind) => {
    render(<MediaLearningWorkbench playback={media(kind)} />);
    await waitFor(() => expect(plyrMock.instances).toHaveLength(1));
    const player = plyrMock.instances[0]!;
    act(() => player.emit("ready"));
    expect(screen.getByText("播放器准备中…")).toBeInTheDocument();

    const element = player.target as HTMLMediaElement;
    let paused = false;
    Object.defineProperty(element, "paused", { get: () => paused });
    fireEvent(element, new Event("play"));
    expect(screen.getByText("正在缓冲…")).toBeInTheDocument();
    fireEvent(element, new Event("canplay"));
    expect(screen.getByText("正在缓冲…")).toBeInTheDocument();
    fireEvent(element, new Event("playing"));
    expect(screen.getByText("正在播放")).toBeInTheDocument();
    fireEvent(element, new Event("waiting"));
    expect(screen.getByText("正在缓冲…")).toBeInTheDocument();

    paused = true;
    fireEvent(element, new Event("pause"));
    fireEvent(element, new Event("waiting"));
    fireEvent(element, new Event("playing"));
    expect(screen.queryByText("正在缓冲…")).not.toBeInTheDocument();
    expect(screen.queryByText("正在播放")).not.toBeInTheDocument();
  });

  it.each(["hosted", "youtube", "podcast"] as const)("creates a connected fresh %s input on source replacement and ignores old events", async (kind) => {
    const onStateChange = vi.fn();
    const onPortChange = vi.fn();
    const props = { title: "Media", autoPause: false, hasSegments: true, onToggleAutoPause: vi.fn(), onPortChange, onStateChange, onPositionChange: vi.fn(), onError: vi.fn() };
    const adapter = (second: boolean) => kind === "youtube"
      ? <VideoPlayerAdapter {...props} embedUrl={`https://www.youtube-nocookie.com/embed/${second ? "secondVideo" : "firstVideo"}`} />
      : kind === "hosted" ? <HostedVideoPlayerAdapter {...props} videoUrl={`https://media.example.test/${second ? "second" : "first"}.mp4`} />
        : <AudioPlayerAdapter {...props} audioUrl={`https://media.example.test/${second ? "second" : "first"}.mp3`} />;
    const view = render(adapter(false));
    await waitFor(() => expect(plyrMock.instances).toHaveLength(1));
    const first = plyrMock.instances[0]!;
    const latestState = vi.fn();
    props.onStateChange = latestState;
    view.rerender(adapter(false));
    act(() => {
      if (kind === "youtube") first.emit("playing");
      else {
        Object.defineProperty(first.target, "paused", { value: false });
        first.target.dispatchEvent(new Event("playing"));
      }
    });
    expect(first.destroy).not.toHaveBeenCalled();
    expect(latestState).toHaveBeenCalledWith("playing");
    expect(onStateChange).not.toHaveBeenCalled();
    view.rerender(adapter(true));
    await waitFor(() => expect(plyrMock.instances).toHaveLength(2));
    const second = plyrMock.instances[1]!;
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(first.target.isConnected).toBe(false);
    expect(second.target).not.toBe(first.target);
    expect(second.target.isConnected).toBe(true);
    latestState.mockClear();
    act(() => {
      first.emit("playing");
      first.target.dispatchEvent(new Event("playing"));
    });
    expect(latestState).not.toHaveBeenCalled();
    act(() => {
      if (kind === "youtube") second.emit("playing");
      else {
        Object.defineProperty(second.target, "paused", { value: false });
        second.target.dispatchEvent(new Event("playing"));
      }
    });
    expect(latestState).toHaveBeenCalledWith("playing");
    view.unmount();
    expect(second.destroy).toHaveBeenCalledOnce();
  });

  it.each(["hosted", "youtube", "podcast"] as const)("keeps the %s player attached while refreshed playback data updates callbacks", async (kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { progress: { revision: 3 } } }))));
    const playback = kind === "podcast" ? media("podcast") : {
      ...media("video"),
      asset: kind === "youtube"
        ? { kind: "official_embed" as const, url: "https://www.youtube-nocookie.com/embed/abc12345678", expiresAt: null }
        : media("video").asset,
    };
    const view = render(<MediaLearningWorkbench playback={playback} />);
    await waitFor(() => expect(plyrMock.instances).toHaveLength(1));
    const first = plyrMock.instances[0]!;
    act(() => first.emit("playing"));
    view.rerender(<MediaLearningWorkbench playback={{ ...playback, segments: [...playback.segments], media: { ...playback.media, progress: { lastPositionMs: 4_000, lastSegmentIndex: null, status: "in_progress", revision: 2 } } }} />);
    await act(async () => {});
    expect(first.destroy).not.toHaveBeenCalled();
    expect(plyrMock.instances).toHaveLength(1);
    expect(first.target.isConnected).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "自动暂停" })).not.toBeInTheDocument();
    view.unmount();
    expect(first.destroy).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("never shows the retired checkbox while Plyr is loading", () => {
    render(<MediaLearningWorkbench playback={media("video")} />);
    expect(screen.queryByRole("checkbox", { name: "自动暂停" })).not.toBeInTheDocument();
  });
  it("mounts Plyr for podcasts instead of leaving native audio controls as the player", async () => {
    render(<MediaLearningWorkbench playback={media("podcast")} />);
    await waitFor(() => expect(plyrMock.instances).toHaveLength(1));
    expect(plyrMock.instances[0]?.target).toBeInstanceOf(HTMLAudioElement);
    expect(plyrMock.instances[0]?.options).toMatchObject({ settings: ["speed"] });
    expect(document.querySelector(".plyr")).toHaveAttribute("data-media-player", "plyr");
    expect(document.querySelector(".plyr")).toHaveAttribute("data-media-player-version", "3.8.4");
    expect(document.querySelector(".media-learning-workbench")).toHaveAttribute("data-media-player-contract", "plyr");
    expect(document.querySelector(".media-learning-workbench")).toHaveAttribute("data-media-player-version", "3.8.4");
    expect(document.querySelector("audio")).not.toHaveAttribute("controls");
  });

  it("mounts Plyr for hosted videos and YouTube embeds through the same workbench", async () => {
    const hosted = render(<MediaLearningWorkbench playback={media("video")} />);
    await waitFor(() => expect(plyrMock.instances).toHaveLength(1));
    expect(plyrMock.instances[0]?.target).toBeInstanceOf(HTMLVideoElement);
    expect(document.querySelector(".plyr")).toHaveAttribute("data-media-player", "plyr");
    expect(document.querySelector(".plyr")).toHaveAttribute("data-media-player-version", "3.8.4");
    expect(document.querySelector(".media-learning-workbench")).toHaveAttribute("data-media-player-contract", "plyr");
    expect(document.querySelector("video")).not.toHaveAttribute("controls");
    hosted.unmount();

    const youtubePlayback = {
      ...media("video"),
      media: { ...media("video").media, id: "video.youtube@1", stableKey: "video.youtube" },
      asset: { kind: "official_embed" as const, url: "https://www.youtube-nocookie.com/embed/abc12345678", expiresAt: null },
    };
    render(<MediaLearningWorkbench playback={youtubePlayback} />);
    await waitFor(() => expect(plyrMock.instances).toHaveLength(2));
    const youtube = plyrMock.instances[1];
    expect(youtube?.target).toHaveAttribute("data-plyr-provider", "youtube");
    expect(youtube?.options).toMatchObject({ youtube: { noCookie: true } });
    expect(document.querySelector(".plyr")).toHaveAttribute("data-media-player", "plyr");
    expect(document.querySelector(".plyr")).toHaveAttribute("data-media-player-version", "3.8.4");
  });

  it("clears a legacy native controls attribute before the shared player mounts", () => {
    const audio = document.createElement("audio");
    audio.setAttribute("controls", "");
    disableNativeMediaControls(audio);
    expect(audio.controls).toBe(false);
    expect(audio).not.toHaveAttribute("controls");
  });
});
