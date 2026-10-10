import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { MediaLibrary } from "@/src/modules/media";

afterEach(cleanup);

/**
 * The media library is the `/learn` shelf: channel tabs, search and a filter
 * popover. The former marketing heading and the topic pills are gone (the
 * product removed the topic navigation), so the assertions pin what the library
 * actually offers today.
 */
describe("media library", () => {
  it("shows an honest empty library without task-style learning actions", () => {
    render(<MediaLibrary result={{ items: [], nextCursor: null, hasMore: false }} query={{}} />);
    expect(screen.queryByRole("heading", { name: "看点、听点真实西语" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "视频" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "播客" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索视频和播客" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "学习主题" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "媒体资料库正在准备中" })).toBeInTheDocument();
    expect(screen.queryByText(/开始第一次练习|继续学习|学习任务时间线/)).not.toBeInTheDocument();
  });

  it("keeps the channel and search while the filter popover carries the range filters", async () => {
    const user = userEvent.setup();
    render(<MediaLibrary result={{ items: [], nextCursor: null, hasMore: false }} query={{ kind: "video", search: "Madrid", cefr: "B1" }} />);
    expect(screen.getByRole("link", { name: "视频" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("searchbox", { name: "搜索视频和播客" })).toHaveValue("Madrid");

    await user.click(screen.getByRole("button", { name: /筛选/ }));
    // The panel and the toolbar's screen-reader copy both carry the fields, so
    // the assertion targets the visible panel.
    const panel = screen.getByRole("heading", { name: "筛选内容" }).closest("div")?.parentElement ?? document.body;
    expect(within(panel).getByRole("combobox", { name: "地区" })).toBeInTheDocument();
    expect(within(panel).getByRole("combobox", { name: "难度" })).toHaveValue("B1");
    expect(within(panel).getByRole("combobox", { name: "时长" })).toBeInTheDocument();
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
  });
});
