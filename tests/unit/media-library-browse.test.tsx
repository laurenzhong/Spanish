import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaLibrary } from "@/src/modules/media";
import type { MediaCard } from "@/src/modules/media/domain";

const card = (key: string): MediaCard => ({
  id: `media.test.${key}@1`, stableKey: `media.test.${key}`, version: 1, kind: "podcast",
  title: key, summary: "", sourceName: "Radio", language: "es", region: "es-ES", cefr: "B1",
  topics: [], durationMs: 60_000, publishedAt: null, curatedAt: "2026-10-13T00:00:00.000Z", contentHash: "a".repeat(64), progress: null,
});
const initial = { items: [card("original")], nextCursor: null, hasMore: false };
const response = (items: MediaCard[], cursor: string | null = null) => new Response(JSON.stringify({ apiVersion: "v1", data: { items }, page: { nextCursor: cursor, hasMore: cursor !== null } }), { headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();
beforeEach(() => {
  window.history.replaceState(null, "", "/learn");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("media library browse interaction", () => {
  it("retains confirmed series summaries after a fetched batch", async () => {
    const item = { ...card("series"), series: { seriesKey: "series.programme", title: "Programa confirmado", kind: "podcast" as const, orderMode: "episodic" as const, revision: 1, seasonNumber: null, episodeNumber: null, episodeLabel: null } };
    fetchMock.mockResolvedValueOnce(response([item]));
    render(<MediaLibrary result={initial} query={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "换一批" }));
    expect(await screen.findByRole("link", { name: /Programa confirmado.*查看系列/ })).toHaveAttribute("href", "/learn/series/series.programme");
  });
  it("continues loading when the sentinel remains near the viewport after a page is appended", async () => {
    vi.stubGlobal("IntersectionObserver", class {
      active = false;
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.active = true;
        queueMicrotask(() => { if (this.active) this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); });
      }
      disconnect() { this.active = false; }
    });
    fetchMock.mockResolvedValueOnce(response([card("page-two")], "page-three"));
    fetchMock.mockResolvedValueOnce(response([card("page-three")]));
    render(<MediaLibrary result={{ ...initial, nextCursor: "page-two", hasMore: true }} query={{}} />);
    await screen.findByRole("link", { name: /page-three/ });
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
  });

  it("does not fetch extra pages solely to fill a five-column grid", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", undefined);
    const originalStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = originalStyle(element);
      if (element.classList.contains("media-grid")) style.gridTemplateColumns = "1fr 1fr 1fr 1fr 1fr";
      return style;
    });
    fetchMock.mockResolvedValueOnce(response([card("unexpected")]));
    render(<MediaLibrary result={{ items: Array.from({ length: 24 }, (_, index) => card(`initial-${index}`)), nextCursor: "next", hasMore: true }} query={{}} />);
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByRole("article")).toHaveLength(24);
  });

  it("coalesces scroll history writes and flushes the latest position before detail navigation", async () => {
    fetchMock.mockResolvedValueOnce(response([card("destination")]));
    render(<MediaLibrary result={initial} query={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "换一批" }));
    const link = await screen.findByRole("link", { name: /destination/ });
    vi.useFakeTimers();
    const historySpy = vi.spyOn(window.history, "replaceState");
    const previousScroll = Object.getOwnPropertyDescriptor(window, "scrollY")!;
    try {
      Object.defineProperty(window, "scrollY", { configurable: true, value: 350 });
      for (let index = 0; index < 30; index++) fireEvent.scroll(window);
      expect(historySpy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(historySpy).toHaveBeenCalledOnce();
      expect(window.history.state.mediaBrowse.scrollY).toBe(350);
      Object.defineProperty(window, "scrollY", { configurable: true, value: 900 });
      fireEvent.scroll(window);
      link.addEventListener("click", (event) => event.preventDefault());
      fireEvent.click(link);
      expect(window.history.state.mediaBrowse.scrollY).toBe(900);
      expect(historySpy).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(200);
      expect(historySpy).toHaveBeenCalledTimes(2);
    } finally { Object.defineProperty(window, "scrollY", previousScroll); }
  });

  it("retries an initial outage with a fresh filtered read and clears the error on success", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    render(<MediaLibrary unavailable result={{ items: [], nextCursor: null, hasMore: false }} query={{ kind: "podcast", cefr: "B1", topic: "daily-life" }} />);
    expect(screen.queryByText("内容准备中")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("读取失败，请重试。");
    expect(screen.queryByRole("heading", { name: "换个筛选条件看看" })).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(response([card("recovered")]));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("link", { name: /recovered/ });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = new URL(fetchMock.mock.calls[1][0], window.location.origin);
    expect(url.pathname).toBe("/api/v1/media");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ kind: "podcast", cefr: "B1", topic: "daily-life", pageSize: "24" });
    expect(fetchMock.mock.calls[1][1].cache).toBe("no-store");
  });

  it("shows a genuine empty state only after a successful empty retry", async () => {
    fetchMock.mockResolvedValueOnce(response([]));
    render(<MediaLibrary unavailable result={{ items: [], nextCursor: null, hasMore: false }} query={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "媒体资料库正在准备中" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not label a failed first batch as an empty catalogue", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    render(<MediaLibrary result={{ items: [], nextCursor: null, hasMore: false }} query={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "换一批" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "换一批" })).not.toBeDisabled());
    expect(screen.queryByText("换一批失败，请重试。")).not.toBeInTheDocument();
    expect(screen.queryByText("内容准备中")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("changes actual content while retaining filters and switches to an explicit browse mode", async () => {
    fetchMock.mockResolvedValue(response([card("replacement")]));
    render(<MediaLibrary result={initial} query={{ kind: "podcast", search: "Madrid", topic: "travel-city", cefr: "B1", region: "es-ES", duration: "short" }} />);
    fireEvent.click(screen.getByRole("button", { name: "换一批" }));
    await screen.findByRole("link", { name: /replacement/ });
    expect(screen.queryByRole("link", { name: /original/ })).not.toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/media/browse");
    expect(JSON.parse(init.body)).toMatchObject({ filters: { kind: "podcast", search: "Madrid", topic: "travel-city", cefr: "B1", region: "es-ES", duration: "short" }, exclude: ["media.test.original"], pageSize: 24 });
    expect(screen.getByRole("combobox", { name: "排序" })).toHaveValue("browse");
    expect(window.location.search).toContain("view=browse");
  });

  it("keeps old cards on failure, prevents repeated clicks and supports retry", async () => {
    let finish: (value: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    render(<MediaLibrary result={initial} query={{}} />);
    const button = screen.getByRole("button", { name: "换一批" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    expect(screen.queryByText("正在换一批…")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /original/ })).toBeInTheDocument();
    finish(new Response("", { status: 503 }));
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.queryByText("换一批失败，请重试。")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /original/ })).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(response([card("retry")]));
    fireEvent.click(screen.getByRole("button", { name: "换一批" }));
    await screen.findByRole("link", { name: /retry/ });
  });

  it("reports exhaustion and restarts browsing only when explicitly requested", async () => {
    fetchMock.mockResolvedValueOnce(response([]));
    render(<MediaLibrary result={initial} query={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "换一批" }));
    await screen.findByText("当前条件下已浏览全部内容。");
    expect(screen.getByRole("link", { name: /original/ })).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(response([card("original")]));
    fireEvent.click(screen.getByRole("button", { name: "重新浏览" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).exclude).toEqual([]);
  });

  it("isolates an obsolete batch response when changing channel", async () => {
    let finish: (value: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    render(<MediaLibrary result={initial} query={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "换一批" }));
    fetchMock.mockResolvedValueOnce(response([card("video-result")]));
    fireEvent.click(screen.getByRole("link", { name: "视频" }));
    await screen.findByRole("link", { name: /video-result/ });
    finish(response([card("obsolete")]));
    await waitFor(() => expect(screen.queryByRole("link", { name: /obsolete/ })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: /video-result/ })).toBeInTheDocument();
  });

  it("restores the batch by revalidating it without storing user progress in history", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(response([card("restored")])));
    const view = render(<MediaLibrary result={initial} query={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "换一批" }));
    await screen.findByRole("link", { name: /restored/ });
    expect(JSON.stringify(window.history.state)).not.toContain("lastPositionMs");
    view.unmount();
    render(<MediaLibrary result={initial} query={{}} />);
    await screen.findByRole("link", { name: /restored/ });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).seed).toBe(JSON.parse(fetchMock.mock.calls[0][1].body).seed);
  });

  it("does not rewrite a detail destination during navigation scroll events", async () => {
    fetchMock.mockResolvedValueOnce(response([card("destination")]));
    render(<MediaLibrary result={initial} query={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "换一批" }));
    await screen.findByRole("link", { name: /destination/ });
    window.history.pushState(null, "", "/learn/media/media.test.destination");
    fireEvent.scroll(window);
    expect(window.location.pathname).toBe("/learn/media/media.test.destination");
    expect(window.history.state?.mediaBrowse).toBeUndefined();
  });

  it("cancels a pending request on unmount", () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    const view = render(<MediaLibrary result={initial} query={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "换一批" }));
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("times out a stalled request, preserves the grid and releases the button", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    render(<MediaLibrary result={initial} query={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "换一批" }));
    await act(() => vi.advanceTimersByTimeAsync(45_001));
    expect(screen.getByRole("link", { name: /original/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "换一批" })).not.toBeDisabled();
    expect(screen.queryByText("换一批失败，请重试。")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("accepts a slow successful batch after the former twenty-second deadline", async () => {
    vi.useFakeTimers();
    const slowResponse = response([card("slow-success")]);
    // A deterministic body avoids Node's real stream scheduling in fake time.
    vi.spyOn(slowResponse, "json").mockResolvedValue({ data: { items: [card("slow-success")] }, page: { nextCursor: null, hasMore: false } });
    fetchMock.mockImplementation((_url, init) => new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => resolve(slowResponse), 22_000);
      init.signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
    }));
    render(<MediaLibrary result={initial} query={{}} />);
    const button = screen.getByRole("button", { name: "换一批" });
    fireEvent.click(button);
    await act(() => vi.advanceTimersByTimeAsync(20_001));
    expect(button).toBeDisabled();
    expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(false);
    expect(screen.getByRole("link", { name: /original/ })).toBeInTheDocument();
    expect(screen.queryByText("正在换一批…")).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole("link", { name: /slow-success/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /original/ })).not.toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
