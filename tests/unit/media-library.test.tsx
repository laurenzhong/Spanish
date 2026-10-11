import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MediaLibrary } from "@/src/modules/media";

afterEach(cleanup);

describe("media library", () => {
  it("shows an honest empty library without task-style learning actions", () => {
    render(<MediaLibrary result={{ items: [], nextCursor: null, hasMore: false }} query={{}} />);
    expect(screen.getByRole("link", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "视频" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "播客" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "学习主题" })).not.toBeInTheDocument();
    expect(screen.queryByText("看点、听点真实西语")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索视频和播客" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "排序" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "媒体资料库正在准备中" })).toBeInTheDocument();
    expect(screen.queryByText(/开始第一次练习|继续学习|学习任务时间线/)).not.toBeInTheDocument();
  });

  it("keeps topic filtering compatible without rendering duplicate topic navigation", () => {
    render(<MediaLibrary result={{ items: [], nextCursor: null, hasMore: false }} query={{ kind: "video", search: "Madrid", topic: "travel-city" }} />);
    expect(screen.queryByRole("navigation", { name: "学习主题" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "视频" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("searchbox", { name: "搜索视频和播客" })).toHaveValue("Madrid");
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
  });

  it("offers the four media CEFR levels in the filter fields", () => {
    render(<MediaLibrary result={{ items: [], nextCursor: null, hasMore: false }} query={{}} />);
    const levels = Array.from(screen.getByRole("combobox", { name: "难度" }).querySelectorAll("option")).map((option) => option.value);
    expect(levels).toEqual(["", "A1", "A2", "B1", "B2"]);
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
