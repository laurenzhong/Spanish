import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";

import type { MediaCard } from "@/src/modules/media/domain/media";
import { MediaSeriesRecommendations } from "@/src/modules/media/ui/media-series-recommendations";
import { initialMediaSeriesRecommendationState, mediaSeriesRecommendationReducer } from "@/src/modules/media/ui/media-series-recommendation-state";

const summary = { seriesKey: "series.fixture", title: "Historias", kind: "video" as const, orderMode: "ordered" as const, revision: 1, seasonNumber: null, episodeNumber: null, episodeLabel: null };
const media: MediaCard = { id: "video.fixture.1@1", stableKey: "video.fixture.1", version: 1, kind: "video", title: "Primera historia", summary: "Una historia", sourceName: "Canal oficial", language: "es", region: "es-ES", cefr: "A2", topics: [], durationMs: 120000, publishedAt: null, curatedAt: "2026-10-16T00:00:00.000Z", contentHash: "a".repeat(64), progress: { status: "completed", lastPositionMs: 120000, lastSegmentIndex: null, revision: 1 }, series: summary };
const series = { ...summary, summary: "Historias del programa oficial", status: "active" as const, episodeCount: 10 };
const item = (index = 2): MediaCard => ({ ...media, id: `video.fixture.${index}@1`, stableKey: `video.fixture.${index}`, title: `Historia ${index}` });
const payload = (items: MediaCard[] = [item()], descriptor: unknown = series) => ({ apiVersion: "v1", data: { series: descriptor, items } });
const response = (value: unknown = payload()) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); fetchMock.mockReset(); });

describe("series recommendation state", () => {
  it("tracks only current generations through start, resolve, error and reset", () => {
    const loading = mediaSeriesRecommendationReducer(initialMediaSeriesRecommendationState, { type: "start", generation: 1 });
    expect(loading.status).toBe("loading");
    expect(mediaSeriesRecommendationReducer(loading, { type: "resolved", generation: 0, result: { series, items: [item()] } })).toBe(loading);
    const ready = mediaSeriesRecommendationReducer(loading, { type: "resolved", generation: 1, result: { series, items: [item()] } });
    expect(ready.status).toBe("ready");
    expect(mediaSeriesRecommendationReducer(ready, { type: "failed", generation: 1, error: "failed" })).toBe(ready);
    const idle = mediaSeriesRecommendationReducer(ready, { type: "reset", generation: 2 });
    expect(idle.status).toBe("idle");
    expect(mediaSeriesRecommendationReducer(idle, { type: "resolved", generation: 1, result: { series, items: [item()] } })).toBe(idle);
    const second = mediaSeriesRecommendationReducer(idle, { type: "start", generation: 3 });
    expect(mediaSeriesRecommendationReducer(second, { type: "resolved", generation: 3, result: { series: null, items: [] } }).status).toBe("empty");
    expect(mediaSeriesRecommendationReducer(second, { type: "failed", generation: 3, error: "timeout" }).status).toBe("error");
  });
});

describe("video series recommendations", () => {
  it("does not request for historical completed progress, false completion, podcasts or no series", () => {
    const view = render(<MediaSeriesRecommendations media={media} completed={false} />);
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(<MediaSeriesRecommendations media={{ ...media, series: null }} completed />);
    view.rerender(<MediaSeriesRecommendations media={{ ...media, kind: "podcast", series: { ...summary, kind: "podcast" } }} completed />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([1, 6])("shows %i same-series video cards only after completion with manual links", async (count) => {
    fetchMock.mockResolvedValue(response(payload(Array.from({ length: count }, (_, index) => item(index + 2)))));
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const scroll = vi.spyOn(window, "scrollTo");
    const view = render(<MediaSeriesRecommendations media={media} completed />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取");
    expect(await screen.findByRole("heading", { name: "当前系列的其他视频" })).toBeInTheDocument();
    expect(view.container.querySelectorAll(".media-card")).toHaveLength(count);
    expect(screen.getByRole("link", { name: "查看全部" })).toHaveAttribute("href", "/learn/series/series.fixture");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/media/video.fixture.1/series-recommendations");
    expect(focus).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
    expect(view.container.querySelector("video,audio")).toBeNull();
  });

  it("deduplicates repeated completed renders and starts fresh after replay", async () => {
    fetchMock.mockImplementation(async () => response());
    const view = render(<MediaSeriesRecommendations media={media} completed />);
    await screen.findByRole("heading", { name: "当前系列的其他视频" });
    view.rerender(<MediaSeriesRecommendations media={{ ...media }} completed />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.rerender(<MediaSeriesRecommendations media={media} completed={false} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    view.rerender(<MediaSeriesRecommendations media={media} completed />);
    await screen.findByRole("heading", { name: "当前系列的其他视频" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("creates one request when StrictMode checks the newly completed subtree", async () => {
    fetchMock.mockImplementation(async () => response());
    render(<StrictMode><MediaSeriesRecommendations media={media} completed /></StrictMode>);
    await screen.findByRole("heading", { name: "当前系列的其他视频" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hides successful empty or missing-series results without claiming an error", async () => {
    for (const value of [payload([], series), payload([], null)]) {
      fetchMock.mockResolvedValueOnce(response(value));
      const view = render(<MediaSeriesRecommendations media={media} completed />);
      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
      expect(view.container).toBeEmptyDOMElement();
      view.unmount();
    }
  });

  it("accepts the authoritative current series after a catalogue move", async () => {
    const moved = { ...series, seriesKey: "series.moved", title: "Nueva serie", revision: 4 };
    fetchMock.mockResolvedValue(response(payload([{ ...item(), series: { ...summary, seriesKey: moved.seriesKey, title: moved.title, revision: 4 } }], moved)));
    render(<MediaSeriesRecommendations media={media} completed />);
    expect(await screen.findByRole("link", { name: "查看全部" })).toHaveAttribute("href", "/learn/series/series.moved");
  });

  it("rejects excess, cross-series, wrong-kind, self and duplicate cards with local retry", async () => {
    for (const value of [
      payload(Array.from({ length: 7 }, (_, index) => item(index + 2))),
      payload([{ ...item(), series: { ...summary, seriesKey: "series.other" } }]),
      payload([{ ...item(), kind: "podcast" }]),
      payload([media]), payload([item(), item()]), payload([{ ...item(), series: null }]),
    ]) {
      fetchMock.mockResolvedValueOnce(response(value));
      const view = render(<MediaSeriesRecommendations media={media} completed />);
      expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法读取");
      expect(screen.queryByRole("heading", { name: "当前系列的其他视频" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
      view.unmount();
    }
  });

  it("keeps failures local and supports retry without changing completion or progress", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response());
    render(<MediaSeriesRecommendations media={media} completed />);
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: "当前系列的其他视频" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
    expect(media.progress?.status).toBe("completed");
  });

  it("times out and aborts even a fetch that ignores cancellation, then retries", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(response());
    render(<MediaSeriesRecommendations media={media} completed />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_001); });
    expect(screen.getByRole("alert")).toHaveTextContent("读取超时");
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试" })); });
    expect(screen.getByRole("heading", { name: "当前系列的其他视频" })).toBeInTheDocument();
  });

  it("cancels on replay or unmount and ignores a stale response after a different video completes", async () => {
    let resolveOld!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce(response(payload([item(8)])));
    const view = render(<MediaSeriesRecommendations media={media} completed />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const oldSignal = fetchMock.mock.calls[0][1]!.signal!;
    view.rerender(<MediaSeriesRecommendations media={media} completed={false} />);
    expect(oldSignal.aborted).toBe(true);
    view.rerender(<MediaSeriesRecommendations media={item(3)} completed />);
    expect(await screen.findByRole("heading", { name: "Historia 8" })).toBeInTheDocument();
    await act(async () => { resolveOld(response()); });
    expect(screen.queryByRole("heading", { name: "Historia 2" })).not.toBeInTheDocument();
    view.unmount();
    expect(fetchMock.mock.calls[1][1]!.signal!.aborted).toBe(true);
  });
});
