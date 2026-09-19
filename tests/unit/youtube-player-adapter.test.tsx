import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { HostedVideoPlayerAdapter, type VideoPlayerPort } from "@/src/modules/media/ui/video-player-adapter";

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
    media: HTMLVideoElement;

    constructor(target: HTMLVideoElement) {
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

function renderPlayer(overrides: Partial<React.ComponentProps<typeof HostedVideoPlayerAdapter>> = {}) {
  return render(<HostedVideoPlayerAdapter
    autoPause={false}
    hasSegments
    onAutoPauseControlReady={vi.fn()}
    onError={vi.fn()}
    onPortChange={vi.fn()}
    onStateChange={vi.fn()}
    onTimeUpdate={vi.fn()}
    onToggleAutoPause={vi.fn()}
    title="Video"
    videoUrl="https://media.example.b-cdn.net/media/video/1/video.mp4"
    {...overrides}
  />);
}

it("uses a native Bunny MP4 surface with the shared Plyr auto-pause control", async () => {
  const onToggleAutoPause = vi.fn();
  const view = renderPlayer({ onToggleAutoPause });

  const video = view.container.querySelector("video");
  expect(video).toHaveAttribute("src", "https://media.example.b-cdn.net/media/video/1/video.mp4");
  expect(view.container.querySelector("iframe")).not.toBeInTheDocument();
  await waitFor(() => expect(view.container.querySelector("[data-media-auto-pause-control]")).toBeInTheDocument());
  const autoPause = view.container.querySelector("[data-media-auto-pause-control]") as HTMLButtonElement;
  expect(autoPause).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(autoPause);
  expect(onToggleAutoPause).toHaveBeenCalledOnce();
});

it("drives the shared player port through native video Plyr", async () => {
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

it("reports a hosted playback error without mentioning YouTube", async () => {
  const onError = vi.fn();
  renderPlayer({ onError });
  await waitFor(() => expect(plyrMock.instances[0]).toBeDefined());
  const player = plyrMock.instances[0]!;
  act(() => player?.emit("error"));
  await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("本站视频资源")));
  expect(onError.mock.calls.flat().join(" ")).not.toMatch(/YouTube|iframe/iu);
});
