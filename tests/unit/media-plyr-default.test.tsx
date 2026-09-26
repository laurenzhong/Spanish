import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaLearningWorkbench } from "@/src/modules/media";

const plyrMock = vi.hoisted(() => ({
  instances: [] as Array<{ target: HTMLElement; options: Readonly<Record<string, unknown>> }>,
}));

vi.mock("plyr", () => ({
  default: class MockPlyr {
    currentTime = 0;
    elements = { controls: document.createElement("div") };
    media: HTMLElement & { error?: { code?: number } };
    private callbacks = new Map<string, Set<() => void>>();

    constructor(target: HTMLElement, options: Readonly<Record<string, unknown>>) {
      this.media = target;
      target.parentElement?.appendChild(this.elements.controls);
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
    destroy() { this.callbacks.clear(); this.elements.controls.remove(); }
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
  });

  it("mounts Plyr for hosted videos and YouTube embeds through the same workbench", async () => {
    const hosted = render(<MediaLearningWorkbench playback={media("video")} />);
    await waitFor(() => expect(plyrMock.instances).toHaveLength(1));
    expect(plyrMock.instances[0]?.target).toBeInstanceOf(HTMLVideoElement);
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
  });
});
