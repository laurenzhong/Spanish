import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaLibrary, type MediaCard } from "@/src/modules/media";

afterEach(cleanup);

describe("media library", () => {
  it("shows an honest empty library without task-style learning actions", () => {
    render(<MediaLibrary result={{ items: [], nextCursor: null, hasMore: false }} query={{}} />);
    expect(screen.getByRole("heading", { name: "学习媒体库" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "视频" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "播客" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索视频和播客" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "媒体资料库正在准备中" })).toBeInTheDocument();
    expect(screen.queryByText(/开始第一次练习|继续学习|学习任务时间线/)).not.toBeInTheDocument();
  });

  it("renders equal-weight direct content links and real resume state", () => {
    render(<MediaLibrary result={{
      items: [{
        id: "media.fixture.cafe@1", stableKey: "media.fixture.cafe", version: 1, kind: "podcast",
        title: "Café de cada día", summary: "Charlas cortas.", sourceName: "Radio ejemplo",
        language: "es", region: "es-ES", cefr: "B1", topics: ["topic.daily-life"], durationMs: 600_000,
        publishedAt: "2026-09-12T08:00:00.000Z", curatedAt: "2026-09-13T08:00:00.000Z",
        contentHash: "a".repeat(64),
        progress: { lastPositionMs: 120_000, lastSegmentIndex: 4, status: "in_progress", revision: 2 },
      }], nextCursor: "next", hasMore: true,
    }} query={{ kind: "podcast" }} />);
    expect(screen.getByRole("link", { name: /Café de cada día/ })).toHaveAttribute("href", "/learn/media/media.fixture.cafe");
    expect(screen.getByText("继续 · 02:00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "加载更多" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "暂无封面：Café de cada día" })).toBeInTheDocument();
  });

  it("renders a real artwork URL with its accessible alt text", () => {
    render(<MediaLibrary result={{ items: [{
      id: "media.fixture.video@1", stableKey: "media.fixture.video", version: 1, kind: "video",
      title: "Una conversación", summary: "", sourceName: "Canal", language: "es", region: "es-ES", cefr: "A2", topics: [], durationMs: 60_000,
      publishedAt: null, curatedAt: "2026-09-13T08:00:00.000Z", contentHash: "b".repeat(64),
      artwork: { url: "https://images.example.test/video.jpg", alt: "Una conversación", source: "youtube", width: 1280, height: 720, expiresAt: null }, progress: null,
    }], nextCursor: null, hasMore: false }} query={{}} />);
    expect(screen.getByRole("img", { name: "Una conversación" })).toHaveAttribute("src", "https://images.example.test/video.jpg");
  });

  it("switches media kinds immediately and reuses cached results", async () => {
    const { userEvent } = await import("@testing-library/user-event");
    const originalFetch = globalThis.fetch;
    const podcast: MediaCard = {
      id: "media.fixture.podcast@1", stableKey: "media.fixture.podcast", version: 1, kind: "podcast",
      title: "Podcast rápido", summary: "Una charla.", sourceName: "Radio", language: "es", region: "es-ES", cefr: "A2", topics: [], durationMs: 120_000,
      publishedAt: null, curatedAt: "2026-09-13T08:00:00.000Z", contentHash: "e".repeat(64), progress: null,
    };
    let resolveResponse!: (response: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => { resolveResponse = resolve; });
    globalThis.fetch = vi.fn().mockReturnValue(responsePromise);
    const user = userEvent.setup();

    try {
      render(<MediaLibrary result={{ items: [], nextCursor: null, hasMore: false }} query={{}} />);
      await user.click(screen.getByRole("link", { name: "播客" }));
      await waitFor(() => expect(screen.getByTestId("media-library")).toHaveAttribute("aria-busy", "true"));
      expect(screen.getByRole("link", { name: "播客" })).toHaveAttribute("aria-current", "page");
      resolveResponse(new Response(JSON.stringify({ data: { items: [podcast] }, page: { nextCursor: null, hasMore: false } }), { status: 200, headers: { "content-type": "application/json" } }));
      expect(await screen.findByRole("link", { name: /Podcast rápido/ })).toHaveAttribute("href", "/learn/media/media.fixture.podcast");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole("link", { name: "全部" }));
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("link", { name: /Podcast rápido/ })).not.toBeInTheDocument();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("opens a keyboard-accessible filter panel and restores focus on cancel", async () => {
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<MediaLibrary result={{ items: [], nextCursor: null, hasMore: false }} query={{}} />);
    const trigger = screen.getByRole("button", { name: "筛选" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "筛选内容" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "地区" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(trigger).toHaveFocus();
  });

  it("appends the next cursor page when the feed sentinel enters the viewport", async () => {
    let observerCallback: IntersectionObserverCallback | undefined;
    const originalIntersectionObserver = window.IntersectionObserver;
    const originalFetch = globalThis.fetch;
    class TestIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds: readonly number[] = [];

      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }

      disconnect() {}
      observe() {}
      takeRecords(): IntersectionObserverEntry[] { return []; }
      unobserve() {}
    }
    Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: TestIntersectionObserver });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { items: [{
        id: "media.fixture.next@1", stableKey: "media.fixture.next", version: 1, kind: "video",
        title: "Siguiente conversación", summary: "Más contenido.", sourceName: "Canal", language: "es", region: "es-ES", cefr: "A2", topics: [], durationMs: 60_000,
        publishedAt: null, curatedAt: "2026-09-13T08:00:00.000Z", contentHash: "c".repeat(64), progress: null,
      }] },
      page: { nextCursor: null, hasMore: false },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    try {
      render(<MediaLibrary result={{ items: [{
        id: "media.fixture.initial@1", stableKey: "media.fixture.initial", version: 1, kind: "video",
        title: "Conversación inicial", summary: "Contenido inicial.", sourceName: "Canal", language: "es", region: "es-ES", cefr: "A2", topics: [], durationMs: 60_000,
        publishedAt: null, curatedAt: "2026-09-13T08:00:00.000Z", contentHash: "d".repeat(64), progress: null,
      }], nextCursor: "cursor-2", hasMore: true }} query={{}} />);
      observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);

      await waitFor(() => expect(screen.getByRole("link", { name: /Siguiente conversación/ })).toBeInTheDocument());
      expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("cursor=cursor-2"), expect.objectContaining({ headers: { accept: "application/json" } }));
      expect(screen.queryByRole("link", { name: "加载更多" })).not.toBeInTheDocument();
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: originalIntersectionObserver });
    }
  });

  it("enables the return-to-top action after scrolling and uses smooth scrolling", async () => {
    const originalScrollY = window.scrollY;
    const originalScrollTo = window.scrollTo;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    window.scrollTo = vi.fn();
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    try {
      render(<MediaLibrary result={{ items: [], nextCursor: null, hasMore: false }} query={{}} />);
      expect(screen.queryByRole("button", { name: "回到顶部" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "刷新页面" })).toBeInTheDocument();
      Object.defineProperty(window, "scrollY", { configurable: true, value: 360 });
      window.dispatchEvent(new Event("scroll"));
      const backToTop = await screen.findByRole("button", { name: "回到顶部" });
      await waitFor(() => expect(backToTop).toBeEnabled());
      await user.click(backToTop);
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    } finally {
      Object.defineProperty(window, "scrollY", { configurable: true, value: originalScrollY });
      window.scrollTo = originalScrollTo;
    }
  });
});
