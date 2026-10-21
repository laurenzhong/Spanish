import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaPlaybackOverview } from "@/src/modules/media";
import type {
  AudioPlayerFactory,
  AudioPlayerLifecycle,
  AudioPlayerPort,
} from "@/src/modules/media";
import { MediaDetailExperience } from "@/src/modules/media/ui/media-detail-experience";
import { resetPlaybackSegmentsRequestsForTests } from "@/src/modules/media/ui/use-media-playback-segments";

const stableKey = "podcast.detail-progressive";
const version = 7;

function word(text: string, startMs: number, endMs: number, startOffset: number, endOffset: number) {
  return { text, startMs, endMs, startOffset, endOffset };
}

function textSegments() {
  return [
    { id: "seg-0", index: 0, startMs: 0, endMs: 1_800, sourceText: "Buenos días.", translation: "早上好。", speaker: null, words: null },
    { id: "seg-1", index: 1, startMs: 1_800, endMs: 4_250, sourceText: "Quería un café con leche.", translation: "我想要一杯拿铁。", speaker: null, words: null },
    { id: "seg-2", index: 2, startMs: 4_250, endMs: 6_000, sourceText: "Claro.", translation: "当然。", speaker: null, words: null },
  ];
}

function fullSegments() {
  return [
    { ...textSegments()[0], words: [word("Buenos", 0, 700, 0, 6), word("días", 700, 1_800, 7, 11)] },
    { ...textSegments()[1], words: [word("Quería", 1_800, 2_200, 0, 6), word("un", 2_200, 2_550, 7, 9), word("café", 2_550, 3_150, 10, 14), word("con", 3_150, 3_650, 15, 18), word("leche", 3_650, 4_250, 19, 24)] },
    { ...textSegments()[2], words: [word("Claro", 4_250, 6_000, 0, 5)] },
  ];
}

function overview(overrides: Partial<MediaPlaybackOverview> = {}): MediaPlaybackOverview {
  return {
    media: {
      id: `${stableKey}@${version}`,
      stableKey,
      version,
      kind: "podcast",
      title: "Una mañana en el mercado",
      summary: "Un episodio breve.",
      sourceName: "Café de cada día",
      language: "es",
      region: "es-ES",
      cefr: "A2",
      topics: ["topic.daily-life"],
      durationMs: 7_000,
      publishedAt: "2026-09-14T08:00:00.000Z",
      curatedAt: "2026-09-14T10:00:00.000Z",
      contentHash: "b".repeat(64),
      progress: { lastPositionMs: 0, lastSegmentIndex: 0, status: "in_progress", revision: 3 },
    },
    asset: { kind: "audio", url: "https://media.example.test/episode.mp3", expiresAt: null },
    segmentCount: 3,
    ...overrides,
  };
}

function payload(segments: unknown[], overrides: { stableKey?: string; version?: number } = {}) {
  return {
    apiVersion: "v1",
    data: {
      media: { stableKey: overrides.stableKey ?? stableKey, version: overrides.version ?? version },
      segments,
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type PendingRequest = Readonly<{
  url: string;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
}>;

/**
 * A fetch seam that only intercepts `/playback`: every playback request is a
 * deferred promise the test resolves, so the loading → text_ready → ready
 * timeline can be asserted step by step.
 */
function installPlaybackFetch() {
  const calls: string[] = [];
  const pending: PendingRequest[] = [];
  const signals: AbortSignal[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/api/v1/media/") || !url.includes("/playback")) {
      return Promise.resolve(jsonResponse({ apiVersion: "v1", data: {} }));
    }
    calls.push(url);
    let resolvePromise!: (response: Response) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<Response>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    if (init?.signal) {
      signals.push(init.signal);
      init.signal.addEventListener("abort", () => rejectPromise(new DOMException("Aborted", "AbortError")), { once: true });
    }
    pending.push({ url, resolve: resolvePromise, reject: rejectPromise });
    return promise;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, pending, signals, fetchMock };
}

function fakeAudioPlayer() {
  let lifecycle: AudioPlayerLifecycle | null = null;
  let currentTimeMs = 0;
  const port: AudioPlayerPort = {
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn((value) => { currentTimeMs = value; }),
    currentTime: vi.fn(() => currentTimeMs),
    destroy: vi.fn(),
  };
  const factory: AudioPlayerFactory = vi.fn((_element, input) => {
    lifecycle = input.lifecycle;
    return port;
  });
  return {
    factory,
    port,
    lifecycle: () => lifecycle!,
    setCurrentTime: (value: number) => { currentTimeMs = value; },
  };
}

/** The transcript splits sentences into word buttons, so assert on the cue row. */
async function findCue(firstWord: string, sentence: string) {
  const word = await screen.findByRole("button", { name: `查看词语 ${firstWord}` });
  const row = word.closest("li");
  expect(row).not.toBeNull();
  expect(row).toHaveTextContent(sentence);
  return word;
}

beforeEach(() => {
  resetPlaybackSegmentsRequestsForTests();
});

afterEach(() => {
  cleanup();
  resetPlaybackSegmentsRequestsForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("progressive media detail transcript", () => {
  it("shows the player first, then text, then word highlighting without remounting the player", async () => {
    const network = installPlaybackFetch();
    const player = fakeAudioPlayer();
    render(<MediaDetailExperience audioPlayerFactory={player.factory} overview={overview()} />);

    // Title/player are already on screen while the transcript request is open.
    expect(screen.getByRole("region", { name: "播客学习器" })).toBeInTheDocument();
    expect(screen.getByText("字幕正在加载…")).toBeVisible();
    expect(screen.getByText("字幕加载中…")).toBeVisible();
    expect(player.factory).toHaveBeenCalledTimes(1);
    expect(network.calls).toEqual([`/api/v1/media/${stableKey}/playback?include=text`]);

    await act(async () => {
      network.pending[0]!.resolve(jsonResponse(payload(textSegments())));
    });
    await findCue("Buenos", "Buenos días.");
    expect(screen.getByText("字幕已加载，逐词高亮准备中…")).toBeVisible();
    expect(screen.getByText("3 段")).toBeVisible();
    // Word timing has not arrived yet: no automatic word highlight is claimed.
    expect(screen.getByRole("button", { name: "查看词语 Buenos" })).not.toHaveAttribute("data-active-word", "true");
    await waitFor(() => expect(network.pending).toHaveLength(2));
    expect(network.pending[1]!.url).toBe(`/api/v1/media/${stableKey}/playback`);

    await act(async () => {
      network.pending[1]!.resolve(jsonResponse(payload(fullSegments())));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "查看词语 Buenos" })).toHaveAttribute("data-active-word", "true"));
    expect(screen.queryByText("字幕已加载，逐词高亮准备中…")).not.toBeInTheDocument();
    // The same player instance survived both transcript phases.
    expect(player.factory).toHaveBeenCalledTimes(1);
    expect(player.port.destroy).not.toHaveBeenCalled();
  });

  it("keeps the rendered text and the player when word timings fail, and retries only that phase", async () => {
    const network = installPlaybackFetch();
    const player = fakeAudioPlayer();
    render(<MediaDetailExperience audioPlayerFactory={player.factory} overview={overview()} />);
    await act(async () => {
      network.pending[0]!.resolve(jsonResponse(payload(textSegments())));
    });
    await findCue("Buenos", "Buenos días.");
    await waitFor(() => expect(network.pending).toHaveLength(2));
    await act(async () => {
      network.pending[1]!.reject(new TypeError("network failed"));
    });
    expect(await screen.findByText("逐词高亮暂时不可用，可重试。")).toBeVisible();
    // The transcript is still there and still usable.
    expect(screen.getByRole("button", { name: "查看词语 Buenos" })).toBeInTheDocument();
    expect(player.port.destroy).not.toHaveBeenCalled();

    screen.getByRole("button", { name: "重试逐词高亮" }).click();
    await waitFor(() => expect(network.pending).toHaveLength(3));
    // Only the word-timing phase is retried; the text request is not repeated.
    expect(network.calls.filter((url) => url.endsWith("?include=text"))).toHaveLength(1);
    await act(async () => {
      network.pending[2]!.resolve(jsonResponse(payload(fullSegments())));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "查看词语 Buenos" })).toHaveAttribute("data-active-word", "true"));
    expect(screen.queryByText("逐词高亮暂时不可用，可重试。")).not.toBeInTheDocument();
  });

  it("shows a retryable error for the text phase while keeping the player available", async () => {
    const network = installPlaybackFetch();
    const player = fakeAudioPlayer();
    render(<MediaDetailExperience audioPlayerFactory={player.factory} overview={overview()} />);
    await act(async () => {
      network.pending[0]!.reject(new TypeError("network failed"));
    });
    expect(await screen.findByText("字幕暂时无法加载，可重试。")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试加载字幕" })).toBeVisible();
    expect(player.factory).toHaveBeenCalledTimes(1);

    screen.getByRole("button", { name: "重试加载字幕" }).click();
    await waitFor(() => expect(network.calls.filter((url) => url.endsWith("?include=text"))).toHaveLength(2));
    await act(async () => {
      network.pending[1]!.resolve(jsonResponse(payload(textSegments())));
    });
    await findCue("Buenos", "Buenos días.");
  });

  it("rejects a transcript that belongs to a different media version", async () => {
    const network = installPlaybackFetch();
    const player = fakeAudioPlayer();
    render(<MediaDetailExperience audioPlayerFactory={player.factory} overview={overview()} />);
    await act(async () => {
      network.pending[0]!.resolve(jsonResponse(payload(textSegments(), { version: version + 1 })));
    });
    expect(await screen.findByText("媒体内容已更新，请刷新页面后重试。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "查看词语 Buenos" })).not.toBeInTheDocument();

    screen.getByRole("button", { name: "重试加载字幕" }).click();
    await waitFor(() => expect(network.pending).toHaveLength(2));
    await act(async () => {
      network.pending[1]!.resolve(jsonResponse(payload(textSegments())));
    });
    await findCue("Buenos", "Buenos días.");
  });

  it("does not let a superseded media's late transcript win after switching items", async () => {
    const network = installPlaybackFetch();
    const player = fakeAudioPlayer();
    const first = overview();
    const secondKey = "podcast.detail-progressive-next";
    const second: MediaPlaybackOverview = {
      ...overview({ media: { ...overview().media, id: `${secondKey}@1`, stableKey: secondKey, version: 1, title: "Otro episodio" } }),
    };
    const view = render(<MediaDetailExperience audioPlayerFactory={player.factory} overview={first} />);
    const oldRequest = network.pending[0]!;
    view.rerender(<MediaDetailExperience audioPlayerFactory={player.factory} overview={second} />);
    await waitFor(() => expect(network.pending.length).toBeGreaterThanOrEqual(2));
    const newRequest = network.pending[1]!;
    expect(newRequest.url).toContain(secondKey);
    await act(async () => {
      newRequest.resolve(jsonResponse(payload([{ ...textSegments()[0], sourceText: "Nuevo episodio." }], { stableKey: secondKey, version: 1 })));
    });
    await findCue("Nuevo", "Nuevo episodio.");
    await act(async () => {
      oldRequest.resolve(jsonResponse(payload(textSegments())));
    });
    expect(screen.queryByRole("button", { name: "查看词语 Buenos" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看词语 Nuevo" })).toBeInTheDocument();
  });

  it("cancels the in-flight transcript request when the page unmounts", async () => {
    const network = installPlaybackFetch();
    const player = fakeAudioPlayer();
    const view = render(<MediaDetailExperience audioPlayerFactory={player.factory} overview={overview()} />);
    expect(network.calls).toHaveLength(1);
    view.unmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(network.signals[0]?.aborted).toBe(true);
  });

  it("issues exactly one request per phase under StrictMode double-mounting", async () => {
    const network = installPlaybackFetch();
    const player = fakeAudioPlayer();
    render(<StrictMode><MediaDetailExperience audioPlayerFactory={player.factory} overview={overview()} /></StrictMode>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(network.calls).toHaveLength(1);
    await act(async () => {
      network.pending[0]!.resolve(jsonResponse(payload(textSegments())));
    });
    await findCue("Buenos", "Buenos días.");
    await waitFor(() => expect(network.pending).toHaveLength(2));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(network.calls.filter((url) => url.endsWith("?include=text"))).toHaveLength(1);
    expect(network.calls.filter((url) => !url.endsWith("?include=text"))).toHaveLength(1);
  });

  it("times out a hung transcript request and offers a retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const player = fakeAudioPlayer();
    render(<MediaDetailExperience audioPlayerFactory={player.factory} overview={overview()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(screen.getByText("字幕加载超时，可重试。")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试加载字幕" })).toBeVisible();
    expect(player.factory).toHaveBeenCalledTimes(1);
  });

  it("skips both transcript requests when the overview says there are no reviewed cues", async () => {
    const network = installPlaybackFetch();
    const player = fakeAudioPlayer();
    render(<MediaDetailExperience audioPlayerFactory={player.factory} overview={overview({ segmentCount: 0 })} />);
    expect(network.calls).toHaveLength(0);
    expect(await screen.findByText("这期播客可以播放，但目前没有已审核的逐句文本。")).toBeVisible();
    expect(screen.getByText("0 段")).toBeVisible();
    expect(player.factory).toHaveBeenCalledTimes(1);
  });
});
