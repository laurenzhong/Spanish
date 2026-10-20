import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaCard } from "@/src/modules/media/domain/media";
import { MediaEpisodePicker } from "@/src/modules/media/ui/media-episode-picker";
import { MediaSeriesPage } from "@/src/modules/media/ui/media-series-page";

const summary = { seriesKey: "series.fixture", title: "Historias", kind: "video" as const, orderMode: "ordered" as const, revision: 1, seasonNumber: null, episodeNumber: null, episodeLabel: null };
const media: MediaCard = { id: "video.fixture.25@1", stableKey: "video.fixture.25", version: 1, title: "La plaza", summary: "Una historia", kind: "video", sourceName: "Canal oficial", language: "es", region: "es-ES", cefr: "A2", topics: [], durationMs: 120000, publishedAt: null, curatedAt: "2026-10-16T00:00:00.000Z", contentHash: "a".repeat(64), progress: { lastPositionMs: 30000, lastSegmentIndex: null, revision: 1, status: "in_progress" }, series: summary };
const previous = { ...media, id: "video.fixture.24@1", stableKey: "video.fixture.24", title: "El mercado" };
const next = { ...media, id: "video.fixture.26@1", stableKey: "video.fixture.26", title: "La estación" };
const page = (overrides = {}) => ({ apiVersion: "v1", data: { series: { ...summary, summary: "Historias del programa oficial", status: "active", episodeCount: 30 }, items: [previous, media, next], anchor: { current: media, previous, next }, nextCursor: null, hasMore: false, ...overrides } });
const ok = (value: unknown = page()) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const fetchMock = vi.fn<typeof fetch>();
let narrow = false;
beforeEach(() => {
  narrow = false;
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: narrow, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); fetchMock.mockReset(); });

describe("series page", () => {
  it("shows catalogue count and original media metadata, without claiming a complete series", async () => {
    fetchMock.mockResolvedValue(ok());
    render(<MediaSeriesPage seriesKey={summary.seriesKey} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取系列");
    expect(await screen.findByRole("heading", { name: "Historias", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("本站已收录 30 集")).toBeInTheDocument();
    expect(screen.getAllByText("Canal oficial").length).toBeGreaterThan(0);
    expect(screen.getAllByText("继续 · 00:30").length).toBeGreaterThan(0);
    expect(screen.queryByText(/全30集|缺集|已完结/u)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/media-series/series.fixture/episodes?pageSize=20");
  });

  it("loads one bounded page at a time and resets invalid cursors explicitly", async () => {
    fetchMock.mockResolvedValueOnce(ok(page({ nextCursor: "cursor-one", hasMore: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "MEDIA_SERIES_CURSOR_INVALID" } }), { status: 400 }))
      .mockResolvedValueOnce(ok());
    render(<MediaSeriesPage seriesKey={summary.seriesKey} />);
    fireEvent.click(await screen.findByRole("button", { name: "下一页" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("系列已更新");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("cursor=cursor-one");
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(String(fetchMock.mock.calls[2][0])).not.toContain("cursor=");
    expect(await screen.findByRole("heading", { name: "Historias", level: 1 })).toBeInTheDocument();
  });

  it("distinguishes unavailable, empty and network failure with a retry", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    const view = render(<MediaSeriesPage seriesKey={summary.seriesKey} />);
    expect(await screen.findByText("这个系列当前不可用。")).toBeInTheDocument();
    view.unmount();
    fetchMock.mockResolvedValueOnce(ok(page({ items: [], series: { ...summary, summary: "", status: "active", episodeCount: 0 }, anchor: { current: null, previous: null, next: null } })));
    const empty = render(<MediaSeriesPage seriesKey={summary.seriesKey} />);
    expect(await screen.findByText("暂无可播放的单集。")).toBeInTheDocument();
    empty.unmount();
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok());
    render(<MediaSeriesPage seriesKey={summary.seriesKey} />);
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: "Historias", level: 1 })).toBeInTheDocument();
  });

  it("aborts stale requests and prevents a previous series response replacing the next series", async () => {
    let resolveOld!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce(ok(page({ series: { ...summary, seriesKey: "series.second", title: "Segundo", summary: "", status: "active", episodeCount: 0 }, items: [], anchor: { current: null, previous: null, next: null } })));
    const view = render(<MediaSeriesPage seriesKey={summary.seriesKey} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const firstSignal = fetchMock.mock.calls[0][1]!.signal!;
    view.rerender(<MediaSeriesPage seriesKey="series.second" />);
    expect(await screen.findByRole("heading", { name: "Segundo", level: 1 })).toBeInTheDocument();
    expect(firstSignal.aborted).toBe(true);
    await act(async () => { resolveOld(ok()); });
    expect(screen.queryByRole("heading", { name: "Historias", level: 1 })).not.toBeInTheDocument();
  });

  it("times out a hung fetch after 20 seconds, cancels it and supports retry", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(ok());
    render(<MediaSeriesPage seriesKey={summary.seriesKey} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_001); });
    expect(screen.getByRole("alert")).toHaveTextContent("读取超时");
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试" })); });
    expect(screen.getByRole("heading", { name: "Historias", level: 1 })).toBeInTheDocument();
  });

  it("rejects malformed or cross-series responses instead of rendering their cards", async () => {
    for (const response of [
      page({ items: [{ ...media, kind: "podcast" }] }),
      page({ items: [{ ...media, series: { ...summary, seriesKey: "series.other" } }] }),
      page({ items: [media, media] }),
      { apiVersion: "v1", data: { items: [] } },
    ]) {
      fetchMock.mockResolvedValueOnce(ok(response));
      const view = render(<MediaSeriesPage seriesKey={summary.seriesKey} />);
      expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法读取");
      expect(screen.queryByRole("heading", { name: "La plaza" })).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("episode picker", () => {
  it("has no placeholder for ungrouped media and loads the current anchor only on opening", async () => {
    const view = render(<MediaEpisodePicker media={{ ...media, series: null }} />);
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(<MediaEpisodePicker media={media} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(ok());
    fireEvent.click(screen.getByRole("button", { name: "选集" }));
    expect(await screen.findByRole("link", { name: /La plaza/u })).toHaveAttribute("aria-current", "true");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/media-series/series.fixture/episodes?pageSize=20&anchorMediaKey=video.fixture.25");
    expect(screen.getByRole("link", { name: "上一集" })).toHaveAttribute("href", "/learn/media/video.fixture.24");
    expect(screen.getByRole("link", { name: "下一集" })).toHaveAttribute("href", "/learn/media/video.fixture.26");
    expect(screen.queryByText(/第25集/u)).not.toBeInTheDocument();
  });

  it("disables a missing neighbor and cancels pending reads on closing or changing the media", async () => {
    fetchMock.mockResolvedValueOnce(ok(page({ anchor: { current: media, previous: null, next } }))).mockImplementationOnce(() => new Promise(() => undefined));
    const view = render(<MediaEpisodePicker media={media} />);
    fireEvent.click(screen.getByRole("button", { name: "选集" }));
    expect(await screen.findByRole("button", { name: "上一集" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "选集" }));
    fireEvent.click(screen.getByRole("button", { name: "选集" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const signal = fetchMock.mock.calls[1][1]!.signal!;
    view.rerender(<MediaEpisodePicker media={next} />);
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "选集" })).toHaveAttribute("aria-expanded", "false");
  });

  it("browses from the first page and restores current-anchor navigation with bounded requests", async () => {
    fetchMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(page({ items: [previous], nextCursor: "next-page", hasMore: true, anchor: { current: null, previous: null, next: null } })))
      .mockResolvedValueOnce(ok(page({ items: [next], anchor: { current: null, previous: null, next: null } })))
      .mockResolvedValueOnce(ok());
    render(<MediaEpisodePicker media={media} />);
    fireEvent.click(screen.getByRole("button", { name: "选集" }));
    fireEvent.click(await screen.findByRole("button", { name: "从头浏览" }));
    await screen.findByRole("link", { name: /El mercado/u });
    expect(String(fetchMock.mock.calls[1][0])).not.toContain("anchorMediaKey");
    expect(screen.getByText("第 1 页")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("link", { name: /La estación/u });
    expect(String(fetchMock.mock.calls[2][0])).toContain("cursor=next-page");
    expect(String(fetchMock.mock.calls[2][0])).not.toContain("anchorMediaKey");
    expect(screen.getByRole("link", { name: "上一集" })).toHaveAttribute("href", "/learn/media/video.fixture.24");
    fireEvent.click(screen.getByRole("button", { name: "定位当前集" }));
    expect(await screen.findByRole("link", { name: /La plaza/u })).toHaveAttribute("aria-current", "true");
    expect(String(fetchMock.mock.calls[3][0])).toContain("anchorMediaKey=video.fixture.25");
    expect(screen.getByText("当前集所在页")).toBeInTheDocument();
  });

  it("positions the current episode inside the list without scrolling the player document", async () => {
    fetchMock.mockResolvedValue(ok());
    const documentScroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this.getAttribute("aria-current") === "true" ? 450 : 100;
      const height = this.getAttribute("aria-current") === "true" ? 64 : 200;
      return { top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) };
    });
    const view = render(<MediaEpisodePicker media={media} />);
    fireEvent.click(screen.getByRole("button", { name: "选集" }));
    await screen.findByRole("link", { name: /La plaza/u });
    expect(view.container.querySelector(".media-episode-picker__list")!.scrollTop).toBeGreaterThan(0);
    expect(documentScroll).not.toHaveBeenCalled();
  });

  it("traps mobile focus, closes on Escape and restores the trigger", async () => {
    narrow = true;
    fetchMock.mockResolvedValue(ok());
    render(<><button>外部控件</button><MediaEpisodePicker media={media} /></>);
    const trigger = screen.getByRole("button", { name: "选集" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "选集" });
    const close = within(dialog).getByRole("button", { name: "关闭选集" });
    expect(close).toHaveFocus();
    await within(dialog).findByRole("link", { name: /La plaza/u });
    const links = within(dialog).getAllByRole("link");
    links.at(-1)!.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(links.at(-1)).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("portals the mobile drawer inside its product shell to inherit workspace theme tokens", async () => {
    narrow = true;
    fetchMock.mockResolvedValue(ok());
    const view = render(<div className="product-shell" style={{ "--surface": "#162127" } as React.CSSProperties}>
      <div className="page-stack" style={{ transform: "translateX(0)" }}><MediaEpisodePicker media={media} /></div>
    </div>);
    const trigger = screen.getByRole("button", { name: "选集" });
    const restoreFocus = vi.spyOn(trigger, "focus");
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "选集" });
    const portal = dialog.closest(".media-episode-drawer");
    expect(portal?.parentElement).toBe(view.container.querySelector(".product-shell"));
    expect(portal?.closest(".page-stack")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(restoreFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(trigger).toHaveFocus();
  });
});
