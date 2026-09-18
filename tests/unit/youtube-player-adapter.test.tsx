import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { VideoPlayerAdapter, youtubeIframePlayerFactory, type VideoPlayerPort } from "@/src/modules/media/ui/video-player-adapter";

const plyrMock = vi.hoisted(() => ({ instances: [] as Array<{
  currentTime: number;
  callbacks: Map<string, Set<() => void>>;
  emit(event: string): void;
}> }));

vi.mock("plyr", () => ({
  default: class MockPlyr {
    currentTime = 0;
    callbacks = new Map<string, Set<() => void>>();
    elements = { controls: document.createElement("div") };
    media: HTMLElement & { error?: { code?: number } };

    constructor(target: HTMLElement) {
      this.media = target;
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

afterEach(() => {
  cleanup();
  plyrMock.instances.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderPlayer(overrides: Partial<React.ComponentProps<typeof VideoPlayerAdapter>> = {}) {
  return render(<VideoPlayerAdapter
    autoPause={false}
    embedUrl="https://www.youtube-nocookie.com/embed/yw5EhfOU2iE"
    hasSegments
    onAutoPauseControlReady={vi.fn()}
    onError={vi.fn()}
    onPortChange={vi.fn()}
    onStateChange={vi.fn()}
    onToggleAutoPause={vi.fn()}
    title="Video"
    {...overrides}
  />);
}

it("uses the shared Plyr surface without obsolete video controls", async () => {
  const view = renderPlayer();

  expect(screen.getByLabelText("Video")).toHaveAttribute("data-plyr-provider", "youtube");
  expect(screen.getByLabelText("Video")).toHaveAttribute("data-plyr-embed-id", "yw5EhfOU2iE");
  await waitFor(() => expect(view.container.querySelector("[data-media-auto-pause-control]")).not.toBeInTheDocument());
  expect(view.container.querySelector("[data-media-auto-pause-control]")).not.toBeInTheDocument();
  expect(view.container).not.toHaveTextContent("在 YouTube 打开");
});

it("drives the shared player port through Plyr", async () => {
  let port: VideoPlayerPort | null = null;
  const onStateChange = vi.fn();
  renderPlayer({ onPortChange: (value) => { port = value; }, onStateChange });
  await waitFor(() => expect(port).not.toBeNull());

  act(() => port!.seek(2_200));
  expect(plyrMock.instances[0]?.currentTime).toBe(2.2);
  act(() => port!.play());
  expect(onStateChange).toHaveBeenCalledWith("playing");
  act(() => port!.pause());
  expect(onStateChange).toHaveBeenCalledWith("paused");
});

it("does not render a YouTube handoff link", async () => {
  const view = renderPlayer();
  await waitFor(() => expect(view.container.querySelector("[data-media-auto-pause-control]")).not.toBeInTheDocument());
  expect(view.container.querySelector("a[href*='youtube.com/watch']")).not.toBeInTheDocument();
});

it("classifies 153 as missing embed identity and sets referrer policy in the direct SDK fallback", () => {
  let events: { onError(event: { data: number }): void };
  const Player = vi.fn(function (target: HTMLElement, options: { events: typeof events }) {
    expect(target).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    expect(target).toHaveAttribute("src", expect.stringContaining("origin="));
    events = options.events;
    return { destroy: vi.fn() };
  });
  vi.stubGlobal("YT", { Player });
  const onError = vi.fn();
  youtubeIframePlayerFactory(document.createElement("div"), { videoId: "yw5EhfOU2iE", lifecycle: { onReady: vi.fn(), onStateChange: vi.fn(), onError } });
  events!.onError({ data: 153 });
  expect(onError).toHaveBeenCalledWith(expect.stringContaining("来源身份"));
  expect(onError).not.toHaveBeenCalledWith(expect.stringMatching(/登录|验证/));
});
