import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaLearningWorkbench } from "@/src/modules/media";
import { disableNativeMediaControls } from "@/src/modules/media/ui/media-plyr";

const plyrMock = vi.hoisted(() => ({
  instances: [] as Array<{ target: HTMLElement; options: Readonly<Record<string, unknown>> }>,
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
      plyrMock.instances.push({ target, options });
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
    destroy() { this.callbacks.clear(); this.elements.container.remove(); }
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
});

describe("default media player", () => {
  it("mounts Plyr for podcasts instead of leaving native audio controls as the player", async () => {
    render(<MediaLearningWorkbench playback={media("podcast")} />);
    await waitFor(() => expect(plyrMock.instances).toHaveLength(1));
    expect(plyrMock.instances[0]?.target).toBeInstanceOf(HTMLAudioElement);
    expect(plyrMock.instances[0]?.options).toMatchObject({ settings: ["speed"] });
    expect(document.querySelector(".plyr")).toHaveAttribute("data-media-player", "plyr");
    expect(document.querySelector(".plyr")).toHaveAttribute("data-media-player-version", "3.8.4");
    expect(document.querySelector("audio")).not.toHaveAttribute("controls");
  });

  it("mounts Plyr for hosted videos and YouTube embeds through the same workbench", async () => {
    const hosted = render(<MediaLearningWorkbench playback={media("video")} />);
    await waitFor(() => expect(plyrMock.instances).toHaveLength(1));
    expect(plyrMock.instances[0]?.target).toBeInstanceOf(HTMLVideoElement);
    expect(document.querySelector(".plyr")).toHaveAttribute("data-media-player", "plyr");
    expect(document.querySelector(".plyr")).toHaveAttribute("data-media-player-version", "3.8.4");
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
