import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HostedVideoPlayerAdapter, VideoPlayerAdapter, type NativeVideoPlayerFactory, type VideoPlayerFactory, type VideoPlayerLifecycle } from "@/src/modules/media/ui/video-player-adapter";

afterEach(() => { cleanup(); });

describe("video player generation event isolation", () => {
  it.each(["hosted", "youtube"] as const)("ignores queued %s ended and position callbacks after source replacement and unmount", (kind) => {
    const lifecycles: VideoPlayerLifecycle[] = [];
    const ports: { destroy: ReturnType<typeof vi.fn> }[] = [];
    const makePort = (lifecycle: VideoPlayerLifecycle) => {
      lifecycles.push(lifecycle);
      const port = { play: vi.fn(), pause: vi.fn(), seek: vi.fn(), currentTime: () => 0, destroy: vi.fn() };
      ports.push(port);
      return port;
    };
    const nativeFactory: NativeVideoPlayerFactory = (_element, input) => makePort(input.lifecycle);
    const youtubeFactory: VideoPlayerFactory = (_element, input) => makePort(input.lifecycle);
    const onStateChange = vi.fn();
    const onPositionChange = vi.fn();
    const onError = vi.fn();
    const props = { title: "Video", autoPause: false, hasSegments: true, onToggleAutoPause: vi.fn(), onPortChange: vi.fn(), onStateChange, onPositionChange, onError };
    const adapter = (second: boolean) => kind === "hosted"
      ? <HostedVideoPlayerAdapter {...props} factory={nativeFactory} videoUrl={`https://fixture.test/${second ? "second" : "first"}.mp4`} />
      : <VideoPlayerAdapter {...props} factory={youtubeFactory} embedUrl={`https://www.youtube-nocookie.com/embed/${second ? "secondVideo" : "firstVideo"}`} />;
    const view = render(adapter(false));
    expect(lifecycles).toHaveLength(1);
    act(() => {
      lifecycles[0].onStateChange("ended");
      lifecycles[0].onPositionChange?.();
    });
    expect(onStateChange).toHaveBeenCalledExactlyOnceWith("ended");
    expect(onPositionChange).toHaveBeenCalledOnce();
    view.rerender(adapter(true));
    expect(lifecycles).toHaveLength(2);
    expect(ports[0].destroy).toHaveBeenCalledOnce();
    onStateChange.mockClear();
    onPositionChange.mockClear();
    onError.mockClear();
    // Retain callbacks directly, simulating SDK work already queued before
    // destroy/off. Removing DOM listeners alone cannot protect this case.
    act(() => {
      lifecycles[0].onStateChange("ended");
      lifecycles[0].onPositionChange?.();
      lifecycles[0].onError("late old error");
      lifecycles[0].onReady();
    });
    expect(onStateChange).not.toHaveBeenCalled();
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    act(() => {
      lifecycles[1].onStateChange("ended");
      lifecycles[1].onPositionChange?.();
    });
    expect(onStateChange).toHaveBeenCalledExactlyOnceWith("ended");
    expect(onPositionChange).toHaveBeenCalledOnce();
    view.unmount();
    expect(ports[1].destroy).toHaveBeenCalledOnce();
    onStateChange.mockClear();
    onPositionChange.mockClear();
    onError.mockClear();
    act(() => {
      lifecycles[1].onStateChange("ended");
      lifecycles[1].onPositionChange?.();
      lifecycles[1].onError("late unmounted error");
    });
    expect(onStateChange).not.toHaveBeenCalled();
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
